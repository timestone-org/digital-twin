"""全局 fixture。

L2/L3 打真实 Postgres（SQLite 上全绿的迁移可以在生产直接失败），每条用例包在
一个回滚事务里，互不残留。本服务没有令牌概念，调用者身份靠 `sign` 造出与边缘
下发形状完全一致的签名头——用例因此走的是与生产同一条鉴权路径。
"""

import os
import socket
import uuid
from collections.abc import AsyncIterator, Callable, Iterable

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
from platform_server.apps.hvac.deps import get_session
from platform_server.container import Container
from platform_server.settings import Settings

# 与 auth-server 的 AUTH_EDGE_PERMISSION_TTL_S 同量级，用例不依赖它的确切取值
HEADER_TTL_S = 60
FULL_CODES = (AC_VIEW, AC_MANAGE)

SignHeaders = Callable[..., dict[str, str]]


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
async def app_client(
    settings: Settings, postgres_available: bool, sign: SignHeaders
) -> AsyncIterator[httpx.AsyncClient]:
    """整装应用的客户端，默认带全权身份头。每条用例一个回滚事务。"""
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

    # 每个请求一个会话，与生产同构：失败即回滚到保存点，不会把后续请求毒死
    async def override() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
            else:
                await session.commit()

    application.dependency_overrides[get_session] = override
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://platform-test", timeout=30
    ) as client:
        client.headers.update(sign())
        yield client

    await transaction.rollback()
    await connection.close()
    await container.database.dispose()
