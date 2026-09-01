"""连真库的 fixture：整装应用包在一条回滚事务里。

L2 打真实 Postgres——SQLite 上全绿的迁移与查询可以在生产直接失败。缺配置或
连不上就跳过，本机因此不必常备一套知识库的库。

⚠ fixture 名一律带 `db_` 前缀：同目录下不连库的用例吃的是根 conftest 那份占位
配置，同名覆盖会把它们一起拖进「必须有真库」。
"""

import socket
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, replace

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
)

from knowledge_server.app import build_app
from knowledge_server.container import IDEMPOTENCY_NAMESPACE, Container
from knowledge_server.deps import get_session
from knowledge_server.settings import Settings
from lib.config import load_settings
from lib.db import run_after_commit_hooks
from lib.idempotency import IdempotencyStore
from lib.objectstore import PresignedPost, UploadLimits
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


class _NoStore:
    """不打网络的假对象存储。

    ⚠ 用例不许打网络，而这一层的 CI 里没有对象存储。真正验直传那几步的用例
    自己塞一个记账的替身进去。
    """

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []
        self.signed: list[str] = []

    async def presign_post(
        self,
        key: str,
        *,
        content_type: str,
        limits: UploadLimits,
        ttl_s: int,
    ) -> PresignedPost:
        del content_type, limits
        self.signed.append(key)
        # 用例把「浏览器传上去了」模拟成直接落一份字节
        self.objects[key] = "# 标题\n正文".encode()
        return PresignedPost(
            url="http://objectstore/ci-bucket",
            fields={"key": key},
            key=key,
            expires_seconds=ttl_s,
        )

    async def get_bytes(self, key: str) -> bytes:
        return self.objects.get(key, b"")

    async def copy(self, source_key: str, target_key: str) -> None:
        self.objects[target_key] = self.objects.get(source_key, b"")

    async def delete(self, key: str) -> None:
        self.deleted.append(key)
        self.objects.pop(key, None)

    async def delete_prefix(self, prefix: str) -> int:
        hit = [one for one in self.objects if one.startswith(prefix)]
        for one in hit:
            del self.objects[one]
        self.deleted.extend(hit)
        return len(hit)


class _NoStream:
    """不打网络的假队列，记下投了什么。"""

    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    async def publish(self, stream: str, fields: dict[str, str]) -> str:
        del stream
        self.sent.append(dict(fields))
        return "1-0"


def _wire(application: FastAPI, connection: AsyncConnection) -> SessionMaker:
    """把事务件换成用例那条连接，外部依赖换成进程内替身。

    ⚠ `join_transaction_mode="create_savepoint"`：请求内的 commit 只落到保存
    点，外层事务最后整体回滚，跨请求可见但不留痕。

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
        objectstore=_NoStore(),  # pyright: ignore[reportArgumentType]
        stream=_NoStream(),  # pyright: ignore[reportArgumentType]
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
        pytest.skip(f"knowledge-server 配置不完整：{error}")
    return loaded.model_copy(
        update={
            "edge_signing_secret": settings.edge_signing_secret,
            "edge_service_key": settings.edge_service_key,
        }
    )


@dataclass(frozen=True)
class DbStack:
    """一条用例手上的整装应用与它的客户端。

    ⚠ 把应用也交出去，是因为有些用例还要往容器里换件。只给客户端的话，
    那种用例只能去掏 transport 的私有字段。
    """

    client: httpx.AsyncClient
    app: FastAPI
    sessions: SessionMaker


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
        base_url="http://knowledge-test",
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


class CommittingSession:
    """一个会话的上下文管理器：正常出块提交，异常回滚。

    ⚠ 必须**提交**：`AsyncSession.__aexit__` 只关不提交，照搬它的话被测代码
    写下去的每一笔都在出块时被丢掉——而用例看到的现象是「状态一直停在
    pending」，与「这段代码根本没跑」长得一模一样。生产那一侧的
    `Database.session()` 是提交的，这里要与它同构。
    """

    def __init__(self, maker: SessionMaker) -> None:
        self._maker = maker
        self._opened: AsyncSession | None = None

    async def __aenter__(self) -> AsyncSession:
        opened = self._maker()
        self._opened = opened
        return opened

    async def __aexit__(self, kind: object, *_rest: object) -> None:
        opened = self._opened
        if opened is None:  # pragma: no cover - 进得来就一定开过
            return
        if kind is None:
            await opened.commit()
            # ⚠ 钩子也要跑：投队列挂在 after-commit 上，不跑的话用例看到的是
            # 「一条消息都没投」，而生产那一侧投了
            await run_after_commit_hooks(opened)
        else:
            await opened.rollback()
        await opened.close()


@pytest.fixture
def db_sessions(
    db_stack: DbStack,
) -> Callable[[], CommittingSession]:
    """开一个新事务的口子，与生产的 `Database.session` 同构。

    ⚠ 跨事务的被测代码（摄取管线每一段自己一个事务）只能用它验：给一个
    现成的会话，那些代码会在自己的 `async with` 里把它关掉。

    Args: db_stack。
    """

    def make() -> CommittingSession:
        return CommittingSession(db_stack.sessions)

    return make


@pytest.fixture
async def db_accelerated(db_sessions: Callable[[], CommittingSession]) -> None:
    """这套库装了加速档的两个扩展吗；没装就跳过。

    ⚠ 环境能力的判定**只许写在 conftest**（`check_tests` 守着这条）：散在用例
    里的 `skip` 会慢慢长成一片，而 CI 里 skip 掉的用例等于没跑。CI 的库两个
    扩展都带，且流水线会跑一次 `python -m knowledge_server.index --enable`——
    所以在 CI 里这条永远不跳。

    Args: db_sessions。
    """
    async with db_sessions() as session:
        found = await session.execute(
            text(
                "SELECT extname FROM pg_extension "
                "WHERE extname IN ('vector', 'pg_trgm')"
            )
        )
        installed = {str(one) for one in found.scalars()}
    missing = {"vector", "pg_trgm"} - installed
    if missing:
        pytest.skip(f"这套库没装：{'、'.join(sorted(missing))}")
