"""全局 fixture。

L2/L3 打真实 Postgres：SQLite 上全绿的迁移与查询可以在生产直接失败。

⚠ 本服务**没有请求级 session 依赖**——事务边界归 service 层自己持有（推送要
在事务外发 Redis）。因此不能像 auth-server 那样把请求会话包进外层事务整体
回滚，改用「每条用例后 TRUNCATE」保证互不残留。

⚠ 用例里不要 `from tests.conftest import ...`：workspace 里每个服务都有一个
顶层 `tests` 包，那条 import 会解析到别的服务的 conftest。
"""

import dataclasses
import os
import socket
from collections.abc import AsyncIterator, Callable
from datetime import timedelta

import httpx
import pytest
from fastapi import FastAPI
from realtime_hub.app import build_app
from realtime_hub.apps.channel.crud import TopicCrud
from realtime_hub.apps.channel.services import SessionService, TopicRegistry
from realtime_hub.container import Container
from realtime_hub.settings import Settings
from sqlalchemy import text

from lib.auth import JwtCodec
from lib.config import load_settings
from lib.db import Database, PoolProfile
from lib.logging import configure_logging
from lib.utils.timeutils import utcnow

TABLES = ("subscription", "topic_declaration")
# 用例里签票的默认存活时长，取值本身不参与断言
TOKEN_TTL_S = 900

TokenFactory = Callable[..., str]

# 假目录里认得的码。⚠ 真实的 HTTP 那条路径由 `tests/unit/test_code_catalog.py`
# 单独守（含 fail-closed）；这里换掉它，是为了不让每条用例都要求 auth 起着。
KNOWN_CODES = frozenset({"opcua:view", "opcua:operate", "opcua:manage"})


class FakeCatalog:
    """固定答案的权限码目录。"""

    async def known_codes(self) -> frozenset[str]:
        return KNOWN_CODES


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
        pytest.skip(f"realtime-hub 配置不完整：{error}")


@pytest.fixture(scope="session", autouse=True)
def _logging() -> None:
    configure_logging(
        service="realtime-hub",
        role="test",
        instance="test",
        level="ERROR",
        log_format="json",
    )


@pytest.fixture(scope="session")
def postgres_available(settings: Settings) -> bool:
    """本机能否连到测试用的 Postgres。"""
    if os.getenv("REALTIME_TEST_SKIP_DB") == "true":
        return False
    return _reachable(settings.postgres_host, settings.postgres_port)


@pytest.fixture
def codec(settings: Settings) -> JwtCodec:
    """与服务同一套密钥的编解码器——用例据它签出「合法的票」。"""
    return JwtCodec(
        signing_key=settings.jwt_secret.get_secret_value(),
        verification_keys=settings.verification_keys(),
        issuer=settings.jwt_issuer,
    )


@pytest.fixture
def token(codec: JwtCodec) -> TokenFactory:
    """签一枚访问令牌。

    ⚠ 默认签的是**合法**票；伪造、过期、alg:none 那几种由用例自己构造，
    不在这里提供便利——那些是安全用例要显式写出来的东西。
    """

    def issue(
        *,
        subject: str = "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        codes: tuple[str, ...] = ("opcua:view",),
        ttl_s: int = TOKEN_TTL_S,
    ) -> str:
        raw, _claims = codec.issue(
            subject=subject,
            token_type="access",
            ttl_s=ttl_s,
            extra={"permissions": list(codes)},
        )
        return raw

    return issue


@pytest.fixture
async def application(
    settings: Settings, postgres_available: bool
) -> AsyncIterator[FastAPI]:
    """整装应用本体。WS 用例要它——TestClient 收的是 app，不是 transport。

    Args: settings, postgres_available。
    """
    if not postgres_available:
        pytest.skip("本机连不到 Postgres")
    built_app = build_app(settings)
    built: Container = built_app.state.container
    built_app.state.container = _with_fake_catalog(built)
    yield built_app
    await built.fanout.stop()
    await built.pubsub.close()
    await built.database.dispose()
    await built.cache.close()


@pytest.fixture
async def app(
    settings: Settings, postgres_available: bool
) -> AsyncIterator[httpx.ASGITransport]:
    """整装应用。

    ⚠ 不起扇出后台任务：那条路径由集成用例单独驱动，让它在每个用例里都跑
    会把 Redis 的连接与任务生命周期混进无关的断言里。

    Args: settings, postgres_available。
    """
    if not postgres_available:
        pytest.skip("本机连不到 Postgres")
    application = build_app(settings)
    built: Container = application.state.container
    application.state.container = _with_fake_catalog(built)
    yield httpx.ASGITransport(app=application)
    await built.fanout.stop()
    await built.pubsub.close()
    await built.database.dispose()
    await built.cache.close()


def _with_fake_catalog(built: Container) -> Container:
    """把跨服务的目录换成假件，其余原样。

    ⚠ registry 与 session 都要一起换：session 持有的是同一个 registry 实例，
    只换前者的话 WS 那条路径仍然会去打 auth。

    Args: built。
    """
    registry = TopicRegistry(
        database=built.database,
        catalog=FakeCatalog(),  # type: ignore[arg-type]  # 结构相同的假件
        topics=TopicCrud(),
    )
    codec = JwtCodec(
        signing_key=built.settings.jwt_secret.get_secret_value(),
        verification_keys=built.settings.verification_keys(),
        issuer=built.settings.jwt_issuer,
    )
    return dataclasses.replace(
        built,
        registry=registry,
        session=SessionService(
            codec=codec,
            registry=registry,
            connections=built.connections,
            journal=built.journal,
        ),
    )


@pytest.fixture
async def client(
    app: httpx.ASGITransport, settings: Settings
) -> AsyncIterator[httpx.AsyncClient]:
    """打整装应用的客户端，默认带服务级密钥（内部端点用）。

    Args: app, settings。
    """
    async with httpx.AsyncClient(
        transport=app,
        base_url="http://test",
        headers={"X-Service-Key": settings.edge_service_key.get_secret_value()},
    ) as handle:
        yield handle


@pytest.fixture
async def _clean(
    settings: Settings, postgres_available: bool
) -> AsyncIterator[None]:
    """每条用例后清表。

    ⚠ 顺序无所谓，`CASCADE` 会把订阅一起带走；显式列出两张表是为了让加表的
    人看得见这里。

    Args: settings, postgres_available。
    """
    yield
    if not postgres_available:
        return
    database = Database(
        dsn=settings.dsn(),
        profile=PoolProfile(),
        search_path=settings.postgres_schema,
    )
    async with database.session() as session:
        for table in TABLES:
            await session.execute(text(f'TRUNCATE TABLE "{table}" CASCADE'))
    await database.dispose()


@pytest.fixture
def expired_token(codec: JwtCodec) -> str:
    """一枚已经过期的票。"""
    raw, _claims = codec.issue(
        subject="3fa85f64-5717-4562-b3fc-2c963f66afa6",
        token_type="access",
        ttl_s=1,
        now=utcnow() - timedelta(hours=2),
    )
    return raw
