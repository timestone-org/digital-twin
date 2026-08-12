"""全局 fixture。

L2/L3 打真实 Postgres（SQLite 上全绿的迁移可以在生产直接失败），每条用例包在
一个回滚事务里，互不残留。本服务没有令牌概念，调用者身份靠 `sign` 造出与边缘
下发形状完全一致的签名头——用例因此走的是与生产同一条鉴权路径。
"""

import os
import socket
import uuid
from collections.abc import AsyncIterator, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lib.auth import (
    SignedContext,
    encode_identity,
    encode_permissions,
    sign_context,
)
from lib.config import load_settings
from lib.logging import configure_logging
from lib.utils.timeutils import utcnow
from platform_server.app import build_app
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.datasets import (
    DATASET_RAW_MINUTE,
    SOURCE_TIME_COLUMN,
    find_dataset,
    metric_keys,
)
from platform_server.apps.hvac.deps import get_ac_source_reader, get_session
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.container import Container
from platform_server.settings import Settings
from platform_server.stream import StreamEntry, StreamGroup

# 与 auth-server 的 AUTH_EDGE_PERMISSION_TTL_S 同量级，用例不依赖它的确切取值
HEADER_TTL_S = 60
FULL_CODES = (AC_VIEW, AC_MANAGE)
# 用例里的源时区固定住，断言里的 UTC 时刻才是可手写的常量
SOURCE_TIMEZONE = "Asia/Shanghai"
# 默认几个形状齐备的对象，够既有的绑定用例用
SEEDED_OBJECTS = ("KTStartData_K01", "KTStartData_K02", "KTStartData_K03")

SignHeaders = Callable[..., dict[str, str]]


def full_shape() -> dict[str, str]:
    """一个形状齐备的对象：时间列 + 目录里的全部指标列。"""
    dataset = find_dataset(DATASET_RAW_MINUTE)
    assert dataset is not None
    columns = {SOURCE_TIME_COLUMN: "datetime"}
    columns.update(dict.fromkeys(metric_keys(dataset), "float"))
    return columns


@dataclass
class FakeAcSource:
    """替掉驱动的假外库：按 SQL 里的特征串分派，不解析 SQL。

    ⚠ 它替的是**驱动**，不是被测逻辑——SQL 文本、时区换算与行映射走的都还是
    真的 `AcSourceReader`，故用例仍然能拦住取数口径写错。
    """

    columns: dict[str, dict[str, str]] = field(default_factory=dict)
    shaped_objects: list[str] = field(default_factory=list)
    captions: list[dict[str, object]] = field(default_factory=list)
    samples: list[dict[str, object]] = field(default_factory=list)
    buckets: list[dict[str, object]] = field(default_factory=list)
    queries: list[tuple[str, dict[str, object]]] = field(default_factory=list)
    failure: Exception | None = None

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]:
        self.queries.append((sql, dict(params)))
        if self.failure is not None:
            raise self.failure
        if "INFORMATION_SCHEMA.COLUMNS" in sql:
            return [{"object_name": name} for name in self.shaped_objects]
        if "KTInfo" in sql:
            return list(self.captions)
        if "DATEADD" in sql:
            return list(self.buckets)
        return list(self.samples)[: _row_limit(params)]

    async def describe_columns(
        self, object_names: Sequence[str]
    ) -> dict[str, dict[str, str]]:
        if self.failure is not None:
            raise self.failure
        return {
            name: self.columns[name]
            for name in object_names
            if name in self.columns
        }


@dataclass
class InMemoryStream:
    """进程内的流假件，满足 `StreamLike`。

    ⚠ `lib.testing` 的 `InMemoryCache` 满足的是 `CacheLike`，那上面没有任何流
    操作，故这里另造一件而不是复用。它刻意保留待确认表：不确认的消息能被再取
    一次，「重复投递」这条才测得出来。
    """

    entries: list[StreamEntry] = field(default_factory=list[StreamEntry])
    pending: list[StreamEntry] = field(default_factory=list[StreamEntry])
    acked: list[str] = field(default_factory=list[str])
    groups: list[str] = field(default_factory=list[str])
    reads: list[tuple[str, int, int]] = field(
        default_factory=list[tuple[str, int, int]]
    )
    claims: list[tuple[str, int, int]] = field(
        default_factory=list[tuple[str, int, int]]
    )
    failure: Exception | None = None
    _serial: int = 0

    async def publish(self, stream: str, fields: Mapping[str, str]) -> str:
        self._serial += 1
        entry_id = f"{stream}:{self._serial}"
        self.entries.append(StreamEntry(entry_id=entry_id, fields=dict(fields)))
        return entry_id

    async def ensure_group(self, target: StreamGroup) -> None:
        self.groups.append(target.group)

    async def read_group(
        self, target: StreamGroup, *, count: int, block_ms: int
    ) -> list[StreamEntry]:
        self.reads.append((target.group, count, block_ms))
        if self.failure is not None:
            raise self.failure
        taken = self.entries[:count]
        del self.entries[:count]
        self.pending.extend(taken)
        return taken

    async def claim_stale(
        self, target: StreamGroup, *, min_idle_ms: int, count: int
    ) -> list[StreamEntry]:
        self.claims.append((target.group, min_idle_ms, count))
        return []

    async def ack(self, target: StreamGroup, entry_id: str) -> None:
        self.acked.append(f"{target.group}:{entry_id}")
        self.pending = [
            item for item in self.pending if item.entry_id != entry_id
        ]

    async def close(self) -> None:
        self.entries.clear()


@pytest.fixture
def stream() -> InMemoryStream:
    """一条空的进程内流。"""
    return InMemoryStream()


def _row_limit(params: Mapping[str, object]) -> int:
    limit = params.get("row_limit")
    return limit if isinstance(limit, int) else 0


def _reachable(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=2):
            return True
    except OSError:
        return False


@pytest.fixture(scope="session")
def settings() -> Settings:
    """从 .env / 环境变量装载配置；缺配置直接跳过依赖真库的层。"""
    try:
        return load_settings(Settings)
    except Exception as error:
        pytest.skip(f"platform-server 配置不完整：{error}")


@pytest.fixture(scope="session", autouse=True)
def _logging() -> None:
    configure_logging(
        service="platform-server",
        role="test",
        instance="test",
        level="ERROR",
        log_format="json",
    )


@pytest.fixture(scope="session")
def postgres_available(settings: Settings) -> bool:
    """本机能否连到测试用的 Postgres。"""
    if os.getenv("PLATFORM_TEST_SKIP_DB") == "true":
        return False
    return _reachable(settings.postgres_host, settings.postgres_port)


@pytest.fixture
def sign(settings: Settings) -> SignHeaders:
    """造一组边缘会下发的签名身份头。

    Args: settings。
    """
    secret = settings.edge_signing_secret.get_secret_value()

    def make(
        codes: Iterable[str] = FULL_CODES,
        *,
        lifetime_s: int = HEADER_TTL_S,
        role: str = "admin",
    ) -> dict[str, str]:
        user_id = str(uuid.uuid4())
        encoded_role = encode_identity(role)
        permissions = encode_permissions(codes)
        expires_at = int(utcnow().timestamp()) + lifetime_s
        context = SignedContext(
            user_id=user_id,
            role=encoded_role,
            permissions_b64=permissions,
            expires_at=expires_at,
        )
        return {
            "X-Auth-User-Id": user_id,
            "X-Auth-Username": encode_identity("测试员"),
            "X-Auth-Role": encoded_role,
            "X-Auth-Permissions": permissions,
            "X-Auth-Exp": str(expires_at),
            "X-Auth-Sig": sign_context(secret, context),
        }

    return make


@pytest.fixture
def ac_source() -> FakeAcSource:
    """假外库，默认已有几个形状齐备的对象。用例可以再往里塞数据。"""
    shape = full_shape()
    return FakeAcSource(
        columns={name: dict(shape) for name in SEEDED_OBJECTS},
        shaped_objects=list(SEEDED_OBJECTS),
    )


def _session_override(
    maker: async_sessionmaker[AsyncSession],
) -> Callable[[], AsyncIterator[AsyncSession]]:
    """每个请求一个会话，与生产同构：失败即回滚到保存点，不毒死后续请求。

    Args: maker。
    """

    async def override() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
            else:
                await session.commit()

    return override


@dataclass
class AppContext:
    """整装应用的客户端与一个**同连接**的会话。

    ⚠ 两者必须共用一条连接：分开连就是两个事务，用例在会话里种下的数据在
    HTTP 那边根本看不见，而现象是「接口返回空列表」，看着像业务逻辑写错了。
    """

    client: httpx.AsyncClient
    session: AsyncSession


@pytest.fixture
async def app_context(
    settings: Settings,
    postgres_available: bool,
    sign: SignHeaders,
    ac_source: FakeAcSource,
) -> AsyncIterator[AppContext]:
    """整装应用 + 同连接的会话，每条用例一个回滚事务。

    ⚠ 外库一律换成假件：用例不许打网络，而真外库在 CI 里也不存在。
    """
    if not postgres_available:
        pytest.skip("本机连不到 Postgres")
    application = build_app(settings)
    container: Container = application.state.container

    connection = await container.database.engine.connect()
    transaction = await connection.begin()
    # join_transaction_mode="create_savepoint"：请求内的 commit 只落到保存点，
    # 外层事务最后整体回滚，跨请求可见但不留痕
    maker = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    application.dependency_overrides[get_session] = _session_override(maker)
    application.dependency_overrides[get_ac_source_reader] = (
        lambda: AcSourceReader(source=ac_source, timezone=SOURCE_TIMEZONE)
    )
    transport = httpx.ASGITransport(app=application)
    async with (
        httpx.AsyncClient(
            transport=transport, base_url="http://platform-test", timeout=30
        ) as client,
        maker() as session,
    ):
        client.headers.update(sign())
        yield AppContext(client=client, session=session)

    await transaction.rollback()
    await connection.close()
    await container.database.dispose()


@pytest.fixture
async def db_session(app_context: AppContext) -> AsyncSession:
    """一个包在回滚事务里的会话，给不经 HTTP 的持久层用例用。

    ⚠ 与 `app_client` 同一条连接：两边看见的是同一个事务里的数据。
    """
    return app_context.session


@pytest.fixture
async def app_client(app_context: AppContext) -> httpx.AsyncClient:
    """整装应用的客户端，默认带全权身份头。"""
    return app_context.client
