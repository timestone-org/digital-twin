"""连真库的 fixture：整装应用包在一条回滚事务里。

L2 打真实 Postgres——SQLite 上全绿的迁移可以在生产直接失败。缺配置或连不上就
跳过，本机因此不必常备一套助手的库。

⚠ fixture 名一律带 `db_` 前缀：同目录下不连库的用例吃的是根 conftest 那份占位
配置，同名覆盖会把它们一起拖进「必须有真库」。
"""

import socket
from collections.abc import AsyncIterator, Callable
from dataclasses import replace

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
)

from ai_assistant.app import build_app
from ai_assistant.apps.chat.api import sessions
from ai_assistant.container import IDEMPOTENCY_NAMESPACE, Container
from ai_assistant.deps import get_session
from ai_assistant.settings import API_PREFIX, Settings
from lib.config import load_settings
from lib.db import run_after_commit_hooks
from lib.idempotency import IdempotencyStore
from lib.testing import InMemoryCache

HeaderFactory = Callable[..., dict[str, str]]
SessionMaker = async_sessionmaker[AsyncSession]

CONNECT_PROBE_TIMEOUT_S = 2
REQUEST_TIMEOUT_S = 30


def _reachable(host: str, port: int) -> bool:
    try:
        with socket.create_connection(
            (host, port), timeout=CONNECT_PROBE_TIMEOUT_S
        ):
            return True
    except OSError:
        return False


def _mount_sessions(application: FastAPI) -> None:
    """会话路由还没进 `ROUTERS` 时由用例挂上。

    ⚠ 判的是「挂没挂」而不是「谁挂的」：登记进 `api/__init__.py` 之后这一步
    自动变成空操作，不会挂出第二份。
    """
    prefix = f"{API_PREFIX}/sessions"
    mounted = any(
        str(getattr(route, "path", "")).startswith(prefix)
        for route in application.routes
    )
    if not mounted:
        application.include_router(sessions.router)


def _session_override(
    maker: SessionMaker,
) -> Callable[[], AsyncIterator[AsyncSession]]:
    """每个请求一个会话，与生产同构：失败即回滚到保存点。

    Args: maker。
    """

    async def override() -> AsyncIterator[AsyncSession]:
        async with maker() as opened:
            try:
                yield opened
            except Exception:
                await opened.rollback()
                raise
            else:
                await opened.commit()
                await run_after_commit_hooks(opened)

    return override


def _wire(application: FastAPI, connection: AsyncConnection) -> None:
    """把事务件换成用例那条连接，幂等键换成进程内替身。

    ⚠ `join_transaction_mode="create_savepoint"`：请求内的 commit 只落到保存
    点，外层事务最后整体回滚，跨请求可见但不留痕。
    ⚠ 幂等键不走 Redis：用例不许打网络，而这一层的 CI 里没有 Redis。
    Args: application, connection。
    """
    built: Container = application.state.container
    maker = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    application.dependency_overrides[get_session] = _session_override(maker)
    application.state.container = replace(
        built,
        idempotency=IdempotencyStore(
            cache=InMemoryCache(), namespace=IDEMPOTENCY_NAMESPACE
        ),
    )


@pytest.fixture
def db_settings(settings: Settings) -> Settings:
    """真库配置。边缘密钥沿用不连库那份，`sign` 造的头对两个应用都有效。

    Args: settings。
    """
    try:
        loaded = load_settings(Settings)
    except Exception as error:
        pytest.skip(f"ai-assistant 配置不完整：{error}")
    return loaded.model_copy(
        update={
            "edge_signing_secret": settings.edge_signing_secret,
            "edge_service_key": settings.edge_service_key,
        }
    )


@pytest.fixture
async def db_client(
    db_settings: Settings, sign: HeaderFactory
) -> AsyncIterator[httpx.AsyncClient]:
    """整装应用的客户端，每条用例一个回滚事务，用完不留痕。

    Args: db_settings, sign。
    """
    if not _reachable(db_settings.postgres_host, db_settings.postgres_port):
        pytest.skip("本机连不到 Postgres")
    application = build_app(db_settings)
    _mount_sessions(application)
    database = application.state.container.database
    connection = await database.engine.connect()
    transaction = await connection.begin()
    _wire(application, connection)
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://assistant-test",
        timeout=REQUEST_TIMEOUT_S,
    ) as client:
        client.headers.update(sign())
        yield client
    await transaction.rollback()
    await connection.close()
    await database.dispose()
