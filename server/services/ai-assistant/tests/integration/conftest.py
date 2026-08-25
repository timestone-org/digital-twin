"""连真库的 fixture：整装应用包在一条回滚事务里。

L2 打真实 Postgres——SQLite 上全绿的迁移可以在生产直接失败。缺配置或连不上就
跳过，本机因此不必常备一套助手的库。

⚠ fixture 名一律带 `db_` 前缀：同目录下不连库的用例吃的是根 conftest 那份占位
配置，同名覆盖会把它们一起拖进「必须有真库」。
"""

import socket
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, replace

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
)

from ai_assistant.app import build_app
from ai_assistant.container import IDEMPOTENCY_NAMESPACE, Container
from ai_assistant.deps import get_session
from ai_assistant.settings import Settings
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


def _wire(
    application: FastAPI, connection: AsyncConnection
) -> async_sessionmaker[AsyncSession]:
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
    return maker


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


@dataclass(frozen=True)
class DbStack:
    """一条用例手上的整装应用与它的客户端。

    ⚠ 把应用也交出去，是因为有些用例还要往容器里换件（比如把模型换成假的）。
    只给客户端的话，那种用例只能去掏 transport 的私有字段。
    """

    client: httpx.AsyncClient
    app: FastAPI
    sessions: async_sessionmaker[AsyncSession]


@pytest.fixture
async def db_stack(
    db_settings: Settings, sign: HeaderFactory
) -> AsyncIterator[DbStack]:
    """整装应用 + 客户端，每条用例一个回滚事务，用完不留痕。

    Args: db_settings, sign。
    """
    if not _reachable(db_settings.postgres_host, db_settings.postgres_port):
        pytest.skip("本机连不到 Postgres")
    application = build_app(db_settings)
    database = application.state.container.database
    connection = await database.engine.connect()
    transaction = await connection.begin()
    maker = _wire(application, connection)
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://assistant-test",
        timeout=REQUEST_TIMEOUT_S,
    ) as client:
        client.headers.update(sign())
        yield DbStack(client=client, app=application, sessions=maker)
    await transaction.rollback()
    await connection.close()
    await database.dispose()


@pytest.fixture
async def db_client(db_stack: DbStack) -> httpx.AsyncClient:
    """整装应用的客户端。

    Args: db_stack。
    """
    return db_stack.client
