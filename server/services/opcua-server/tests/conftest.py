"""全局 fixture。

L2/L3 打真实 Postgres（SQLite 上全绿的迁移与查询可以在生产直接失败）。

⚠ 隔离方式与 auth-server 不同。那边把请求级的 `get_session` 依赖换成一个包在
外层事务里的会话，用完整体回滚；本服务**没有**请求级 session 依赖——起停实例
是外部 IO，事务边界因此归 service 层自己持有（见 `apps/instance/deps.py`）。
覆盖不到那些自持的会话，所以这里改用「每条用例后 TRUNCATE」来保证互不残留。
"""

import os
import socket
from collections.abc import AsyncIterator, Callable, Iterator
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import text

from lib.auth import (
    SignedContext,
    encode_identity,
    encode_permissions,
    sign_context,
)
from lib.config import load_settings
from lib.db import Database, PoolProfile
from lib.logging import configure_logging
from lib.testing import InMemoryCache
from lib.utils.timeutils import utcnow
from opcua_server.app import build_app
from opcua_server.container import Container
from opcua_server.settings import Settings

# 五张表都挂在实例上，CASCADE 一条就够；显式列出是为了让加表的人看得见这里
TABLES = (
    "opcua_instances",
    "opcua_nodes",
    "opcua_types",
    "opcua_instance_credentials",
    "opcua_instance_trusted_certs",
)
# 身份头的有效期。测试里只要不是 0 就行，取值本身不参与断言
HEADER_TTL_S = 300

# ⚠ 用例里不要 `from tests.conftest import ...`：workspace 里每个服务都有一个
# 顶层 `tests` 包，那条 import 会解析到别的服务的 conftest。
HeaderFactory = Callable[..., dict[str, str]]


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
        pytest.skip(f"opcua-server 配置不完整：{error}")


@pytest.fixture(scope="session", autouse=True)
def _logging() -> None:
    configure_logging(
        service="opcua-server",
        role="test",
        instance="test",
        level="ERROR",
        log_format="json",
    )


@pytest.fixture(scope="session")
def postgres_available(settings: Settings) -> bool:
    """本机能否连到测试用的 Postgres。"""
    if os.getenv("OPCUA_TEST_SKIP_DB") == "true":
        return False
    return _reachable(settings.postgres_host, settings.postgres_port)


@pytest.fixture
async def app(
    settings: Settings, postgres_available: bool
) -> AsyncIterator[httpx.ASGITransport]:
    """整装应用。缓存换成进程内假件——幂等键的语义由假件同样满足。

    Args: settings, postgres_available。
    """
    if not postgres_available:
        pytest.skip("本机连不到 Postgres")
    application = build_app(settings)
    built: Container = application.state.container
    application.state.container = _with_fake_cache(built)
    yield httpx.ASGITransport(app=application)
    await built.supervisor.stop_all()
    await built.database.dispose()
    await built.cache.close()


def _with_fake_cache(built: Container) -> Container:
    """把 Redis 换成进程内假件，其余原样。

    Args: built。
    """
    cache = InMemoryCache()
    return Container(
        settings=built.settings,
        database=built.database,
        cache=cache,
        supervisor=built.supervisor,
        instances=built.instances,
        nodes=built.nodes,
        security=built.security,
        idempotency=type(built.idempotency)(cache=cache),
    )


@pytest.fixture
async def client(
    app: httpx.ASGITransport,
) -> AsyncIterator[httpx.AsyncClient]:
    """打整装应用的客户端。默认不带身份头——要带的用例自己加。

    Args: app。
    """
    async with httpx.AsyncClient(
        transport=app, base_url="http://opcua-test", timeout=30
    ) as http_client:
        yield http_client


@pytest.fixture
async def clean_tables(settings: Settings) -> AsyncIterator[None]:
    """每条用例后清表。

    ⚠ 不能只回滚：service 层自己持有事务并已提交，外层没有可回滚的东西。

    Args: settings。
    """
    yield
    database = Database(
        dsn=settings.dsn(),
        profile=PoolProfile(),
        search_path=settings.postgres_schema,
    )
    async with database.session() as session:
        joined = ", ".join(f"{settings.postgres_schema}.{t}" for t in TABLES)
        await session.execute(text(f"TRUNCATE {joined} CASCADE"))
    await database.dispose()


@pytest.fixture
def sign_headers(settings: Settings) -> HeaderFactory:
    """造一份边缘会下发的签名身份头。

    ⚠ 这不是「绕过鉴权」：它复用 auth-server 用的同一套编解码与同一个密钥，
    伪造签名的用例照样会被拒——那正是要测的。

    Args: settings。
    """

    def factory(*codes: str, user_id: UUID | None = None) -> dict[str, str]:
        subject = str(user_id or uuid4())
        role = encode_identity("tester")
        permissions = encode_permissions(codes)
        expires_at = int(utcnow().timestamp()) + HEADER_TTL_S
        signature = sign_context(
            settings.edge_signing_secret.get_secret_value(),
            SignedContext(
                user_id=subject,
                role=role,
                permissions_b64=permissions,
                expires_at=expires_at,
            ),
        )
        return {
            "X-Auth-User-Id": subject,
            "X-Auth-Username": encode_identity("tester"),
            "X-Auth-Role": role,
            "X-Auth-Permissions": permissions,
            "X-Auth-Exp": str(expires_at),
            "X-Auth-Sig": signature,
        }

    return factory


@pytest.fixture
def free_port() -> Iterator[int]:
    """取一个当前空闲的端口，用完即弃。

    ⚠ 不许硬编码端口：并行跑用例时会撞车，而撞车的表现是「实例起不来」，
    与真缺陷长得一模一样。
    """
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        yield int(probe.getsockname()[1])
