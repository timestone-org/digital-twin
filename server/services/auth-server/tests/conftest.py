"""全局 fixture。

L2/L3 打真实 Postgres（SQLite 上全绿的迁移可以在生产直接失败），
每条用例包在一个回滚事务里，互不残留；Redis 用进程内假件，
真实过期时序由单独的集成用例覆盖。
"""

import os
import socket
from collections.abc import AsyncIterator

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from auth_server.app import build_app
from auth_server.apps.auth.deps import get_session
from auth_server.container import Container, build_container
from auth_server.settings import Settings
from lib.auth import PasswordHasher
from lib.config import load_settings
from lib.logging import configure_logging
from lib.testing import InMemoryCache

# ⚠ 必须与种子账号同参：参数不同会让每次登录都判 needs_rehash 为真，
# 于是每条用例都去 UPDATE 同一行口令散列，跨用例抢锁并偶发 lock timeout。
# 「测试跑得快」不值得用一个只在测试里存在的写放大来换。
TEST_HASHER = PasswordHasher()


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
        pytest.skip(f"auth-server 配置不完整：{error}")


@pytest.fixture(scope="session", autouse=True)
def _logging() -> None:
    configure_logging(
        service="auth-server",
        role="test",
        instance="test",
        level="ERROR",
        log_format="json",
    )


@pytest.fixture(scope="session")
def postgres_available(settings: Settings) -> bool:
    """本机能否连到测试用的 Postgres。"""
    if os.getenv("AUTH_TEST_SKIP_DB") == "true":
        return False
    return _reachable(settings.postgres_host, settings.postgres_port)


@pytest.fixture
async def container(settings: Settings) -> AsyncIterator[Container]:
    """真库 + 假缓存的容器。"""
    built = build_container(settings)
    patched = Container(
        settings=built.settings,
        database=built.database,
        cache=built.cache,
        hasher=TEST_HASHER,
        tokens=built.tokens,
        auth=built.auth,
        verify=built.verify,
        rules=built.rules,
    )
    yield patched
    await built.database.dispose()
    await built.cache.close()


@pytest.fixture
async def app_client(
    settings: Settings, postgres_available: bool
) -> AsyncIterator[httpx.AsyncClient]:
    """整装应用的客户端。每条用例一个回滚事务，用完不留痕。"""
    if not postgres_available:
        pytest.skip("本机连不到 Postgres")
    application = build_app(settings)
    built: Container = application.state.container
    swapped = _with_test_doubles(built)
    application.state.container = swapped

    connection = await swapped.database.engine.connect()
    transaction = await connection.begin()
    # join_transaction_mode="create_savepoint"：请求内的 commit 只落到保存点，
    # 外层事务最后整体回滚，跨请求可见但不留痕
    maker = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    # 每个请求一个会话，与生产同构：失败即回滚到保存点，不会把后续请求一起毒死
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
        transport=transport, base_url="http://auth-test", timeout=30
    ) as client:
        client.headers["X-Service-Key"] = (
            settings.edge_service_key.get_secret_value()
        )
        yield client

    await transaction.rollback()
    await connection.close()
    await built.database.dispose()
    await built.cache.close()


def _with_test_doubles(built: Container) -> Container:
    cache = InMemoryCache()
    tokens = built.tokens.__class__(
        codec=built.tokens.codec,
        cache=cache,
        access_ttl_s=built.tokens.access_ttl_s,
        refresh_ttl_s=built.tokens.refresh_ttl_s,
    )
    auth = built.auth.__class__(
        tokens=tokens,
        hasher=TEST_HASHER,
        login_limiter=_relimit(built.auth.login_limiter, cache),
        signup_limiter=_relimit(built.auth.signup_limiter, cache),
        signup_enabled=built.auth.signup_enabled,
        signup_default_role=built.auth.signup_default_role,
        clock=built.auth.clock,
    )
    verify = built.verify.__class__(
        tokens=tokens,
        rules=built.rules,
        signing_secret=built.verify.signing_secret,
        header_ttl_s=built.verify.header_ttl_s,
        clock=built.verify.clock,
    )
    return Container(
        settings=built.settings,
        database=built.database,
        cache=built.cache,
        hasher=TEST_HASHER,
        tokens=tokens,
        auth=auth,
        verify=verify,
        rules=built.rules,
    )


def _relimit(limiter: object, cache: InMemoryCache) -> object:
    return limiter.__class__(
        cache=cache,
        namespace=limiter.namespace,
        limit=limiter.limit,
        window_s=limiter.window_s,
        message=limiter.message,
    )
