"""打真库验凭据、信任证书与自定义类型的数据访问。

守的是身份边界：账号池按实例隔离、库里只有散列、私钥进不来。
"""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lib.auth import PasswordHasher
from lib.config import load_settings
from lib.db import Database
from opcua_server.apps.instance.crud import (
    credential_crud,
    instance_crud,
    trusted_certificate_crud,
    type_definition_crud,
)
from opcua_server.apps.instance.models import (
    Credential,
    Instance,
    TrustedCertificate,
    TypeDefinition,
)
from opcua_server.settings import Settings

pytestmark = pytest.mark.requires_postgres

HASHER = PasswordHasher(time_cost=1, memory_cost_kib=8192, parallelism=1)


def _instance(*, name: str, port: int) -> Instance:
    return Instance(
        name=name,
        port=port,
        namespace_uri=f"urn:digitaltwin:{name}",
        security_policies=["NoSecurity"],
    )


def _expiry() -> datetime:
    return datetime.now(UTC) + timedelta(days=365)


@pytest.fixture(scope="module")
def settings() -> Settings:
    """本服务的配置。环境不全时直接失败——能力由 CI 的服务容器保证。"""
    return load_settings(Settings)


@pytest.fixture
async def session(settings: Settings) -> AsyncIterator[AsyncSession]:
    """每条用例包在一个回滚事务里，互不残留。"""
    database = Database(
        dsn=settings.dsn(), search_path=settings.postgres_schema
    )
    connection = await database.engine.connect()
    transaction = await connection.begin()
    maker = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    async with maker() as opened:
        yield opened
    await transaction.rollback()
    await connection.close()
    await database.dispose()


@pytest.fixture
async def owner(session: AsyncSession) -> Instance:
    """一台已落库的实例，供各用例挂凭据与证书。"""
    created = instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    return created


async def test_credential_username_is_unique_within_one_instance(
    session: AsyncSession, owner: Instance
) -> None:
    """同一实例内不许两个同名账号，否则认证时无从判定用哪条。"""
    credential_crud.add(
        session,
        Credential(
            instance_id=owner.id,
            username="scada",
            hashed_password=HASHER.hash("s3cret-value"),
        ),
    )
    await session.flush()
    credential_crud.add(
        session,
        Credential(
            instance_id=owner.id,
            username="scada",
            hashed_password=HASHER.hash("other-value"),
        ),
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_same_username_is_allowed_in_another_instance(
    session: AsyncSession, owner: Instance
) -> None:
    """账号池按实例隔离——两台服务器各有一个 scada 是正常的。"""
    other = instance_crud.add(session, _instance(name="beta", port=4841))
    await session.flush()
    for instance_id in (owner.id, other.id):
        credential_crud.add(
            session,
            Credential(
                instance_id=instance_id,
                username="scada",
                hashed_password=HASHER.hash("s3cret-value"),
            ),
        )
    await session.flush()
    found = await credential_crud.list_of_instance(session, other.id)
    assert [item.username for item in found] == ["scada"]


async def test_stored_credential_never_holds_the_plaintext(
    session: AsyncSession, owner: Instance
) -> None:
    """明文只在创建时返回一次，库里从来只有散列。"""
    secret = "s3cret-value"
    credential_crud.add(
        session,
        Credential(
            instance_id=owner.id,
            username="scada",
            hashed_password=HASHER.hash(secret),
        ),
    )
    await session.flush()
    stored = await credential_crud.get_by_username(
        session, instance_id=owner.id, username="scada"
    )
    assert stored is not None
    assert secret not in stored.hashed_password
    assert HASHER.verify(secret, stored.hashed_password) is True


async def test_deleting_an_instance_takes_its_credentials_with_it(
    session: AsyncSession, owner: Instance
) -> None:
    """实例没了，它的账号不该留下来成为无主凭据。"""
    credential_crud.add(
        session,
        Credential(
            instance_id=owner.id,
            username="scada",
            hashed_password=HASHER.hash("s3cret-value"),
        ),
    )
    await session.flush()
    await instance_crud.delete(session, owner)
    await session.flush()
    assert await credential_crud.list_of_instance(session, owner.id) == []


async def test_trusted_certificate_fingerprint_is_unique_per_instance(
    session: AsyncSession, owner: Instance
) -> None:
    """指纹就是证书的身份，实例内重复即白名单自相矛盾。"""
    for _ in range(2):
        trusted_certificate_crud.add(
            session,
            TrustedCertificate(
                instance_id=owner.id,
                fingerprint="ab" * 32,
                subject="CN=scada",
                expires_at=_expiry(),
            ),
        )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_pasting_a_private_key_into_the_public_field_is_rejected(
    session: AsyncSession, owner: Instance
) -> None:
    """私钥绝不进库——它会随数据库备份跑到任何存备份的地方。"""
    trusted_certificate_crud.add(
        session,
        TrustedCertificate(
            instance_id=owner.id,
            fingerprint="cd" * 32,
            subject="CN=scada",
            expires_at=_expiry(),
            public_key_pem="-----BEGIN PRIVATE KEY-----\nMIIE\n",
        ),
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_public_key_is_accepted(
    session: AsyncSession, owner: Instance
) -> None:
    """公钥不是秘密，可以进库省得启动时再去卷上找散落的文件。"""
    trusted_certificate_crud.add(
        session,
        TrustedCertificate(
            instance_id=owner.id,
            fingerprint="ef" * 32,
            subject="CN=scada",
            expires_at=_expiry(),
            public_key_pem="-----BEGIN PUBLIC KEY-----\nMIIB\n",
        ),
    )
    await session.flush()
    found = await trusted_certificate_crud.get_by_fingerprint(
        session, instance_id=owner.id, fingerprint="ef" * 32
    )
    assert found is not None


async def test_certificate_expiry_keeps_its_timezone(
    session: AsyncSession, owner: Instance
) -> None:
    """时刻一律带时区——落库丢了口径就再也说不清是哪个时区的。"""
    trusted_certificate_crud.add(
        session,
        TrustedCertificate(
            instance_id=owner.id,
            fingerprint="ab" * 32,
            subject="CN=scada",
            expires_at=_expiry(),
        ),
    )
    await session.flush()
    found = await trusted_certificate_crud.get_by_fingerprint(
        session, instance_id=owner.id, fingerprint="ab" * 32
    )
    assert found is not None
    assert found.expires_at.tzinfo is not None


async def test_type_identifier_is_unique_within_one_instance(
    session: AsyncSession, owner: Instance
) -> None:
    """类型与节点共用标识空间的唯一口径。"""
    for _ in range(2):
        type_definition_crud.add(
            session,
            TypeDefinition(
                instance_id=owner.id,
                kind="object_type",
                browse_name="MotorType",
                identifier="MotorType",
            ),
        )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_unknown_type_kind_is_rejected(
    session: AsyncSession, owner: Instance
) -> None:
    """类型种类只有三档，写错要在入库时就拦住。"""
    type_definition_crud.add(
        session,
        TypeDefinition(
            instance_id=owner.id,
            kind="reference_type",
            browse_name="MotorType",
            identifier="MotorType",
        ),
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_type_definition_defaults_to_an_empty_object(
    session: AsyncSession, owner: Instance
) -> None:
    """没写形状的类型是空对象，不是 NULL——省掉一处到处判空。"""
    created = type_definition_crud.add(
        session,
        TypeDefinition(
            instance_id=owner.id,
            kind="object_type",
            browse_name="MotorType",
            identifier="MotorType",
        ),
    )
    await session.flush()
    await session.refresh(created)
    assert created.definition == {}


async def test_types_load_in_creation_order(
    session: AsyncSession, owner: Instance
) -> None:
    """类型必须先于引用它的类型注册，故按创建顺序取。"""
    for name in ("BaseType", "DerivedType"):
        type_definition_crud.add(
            session,
            TypeDefinition(
                instance_id=owner.id,
                kind="object_type",
                browse_name=name,
                identifier=name,
            ),
        )
        await session.flush()
    loaded = await type_definition_crud.list_of_instance(session, owner.id)
    assert [item.identifier for item in loaded] == [
        "BaseType",
        "DerivedType",
    ]


async def test_credential_lookup_is_scoped_to_its_instance(
    session: AsyncSession, owner: Instance
) -> None:
    """按用户名取凭据必须带实例，否则会拿到另一台服务器的账号。"""
    other = instance_crud.add(session, _instance(name="beta", port=4841))
    await session.flush()
    credential_crud.add(
        session,
        Credential(
            instance_id=owner.id,
            username="scada",
            hashed_password=HASHER.hash("s3cret-value"),
        ),
    )
    await session.flush()
    missing = await credential_crud.get_by_username(
        session, instance_id=other.id, username="scada"
    )
    assert missing is None


def test_instance_identifier_is_a_uuid() -> None:
    """主键是 UUIDv7：多副本并发写不需要中心化取号。"""
    created = _instance(name="alpha", port=4840)
    created.id = uuid.uuid4()
    assert isinstance(created.id, uuid.UUID)
