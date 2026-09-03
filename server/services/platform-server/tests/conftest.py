"""全局 fixture。

L2/L3 打真实 Postgres（SQLite 上全绿的迁移可以在生产直接失败），每条用例包在
一个回滚事务里，互不残留。本服务没有令牌概念，调用者身份靠 `sign` 造出与边缘
下发形状完全一致的签名头——用例因此走的是与生产同一条鉴权路径。
"""

import os
import socket
import uuid
from collections.abc import AsyncIterator, Callable, Iterable
from dataclasses import dataclass, replace
from datetime import datetime

import httpx
import pytest
from fastapi import FastAPI
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
)
from unit.collect_fakes import (
    FakeChannelPublisher,
    FakeCommandTransport,
    FakeHistorySource,
)
from unit.database_fakes import MakerSessions, rollback_sessions
from unit.dataset_fakes import FakeSetSink, RecordingRunner
from unit.opcua_fakes import FakeNodeWriter
from unit.source_fakes import FakeAcSource, InMemoryStream, full_shape

from lib.auth import (
    SignedContext,
    encode_identity,
    encode_permissions,
    sign_context,
)
from lib.config import load_settings
from lib.db import Database, run_after_commit_hooks
from lib.idempotency import IdempotencyStore
from lib.logging import configure_logging
from lib.testing import FakeObjectStore, InMemoryCache
from lib.utils.timeutils import utcnow
from platform_server.app import build_app
from platform_server.apps.assets.catalog import ASSET_MANAGE, ASSET_VIEW
from platform_server.apps.assets.deps import get_object_store
from platform_server.apps.collect.catalog import (
    COLLECT_MANAGE,
    COLLECT_OPERATE,
    COLLECT_VIEW,
)
from platform_server.apps.collect.services import (
    CommandBus,
    PlanNotifier,
    ReadOnlyHistorySource,
)
from platform_server.apps.dashboard.catalog import (
    DASHBOARD_EDIT,
    DASHBOARD_MANAGE,
    DASHBOARD_VIEW,
)
from platform_server.apps.dashboard.deps import (
    get_validation_context as get_dashboard_validation_context,
)
from platform_server.apps.dashboard.services import (
    SUBSCRIPTION_SCHEMA,
    ReadOnlyViewerSource,
    StaticPointCatalog,
    ValidationContext,
)
from platform_server.apps.dataset import catalog as dataset_catalog
from platform_server.apps.dataset.services import (
    BackfillJobs,
    BackfillRunner,
    DatasetDirtyLog,
)
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.deps import (
    get_ac_source_reader,
    get_node_writer,
    get_sessions,
)
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.llm_providers.catalog import LLM_MANAGE, LLM_VIEW
from platform_server.apps.modeling import catalog as modeling_catalog
from platform_server.apps.modeling.deps import get_modeling_sessions
from platform_server.container import (
    IDEMPOTENCY_NAMESPACE,
    TIMESCALE_SCHEMA,
    Container,
)
from platform_server.deps import get_session
from platform_server.settings import Settings
from timeseries import HISTORY_SCHEMA

# 与 auth-server 的 AUTH_EDGE_PERMISSION_TTL_S 同量级，用例不依赖它的确切取值。
# ⚠ 别往下调：身份头在夹具里签一次给整条用例用，CPU 受限的容器里从签发到发请求
# 撑过这个数就是一片 40100，且每轮红的是不同的几条——看着像认证坏了，其实是慢。
# 测过期的用例显式传 `lifetime_s=-1`，不吃这个默认值。
HEADER_TTL_S = 300
# ⚠ 每加一个受权限守着的功能面都要往这里补：漏了不是「那面没被测到」，
# 而是那面**全部用例整片 403**，而失败信息只说不可迭代 None
FULL_CODES = (
    AC_VIEW,
    AC_MANAGE,
    DASHBOARD_VIEW,
    DASHBOARD_EDIT,
    DASHBOARD_MANAGE,
    COLLECT_VIEW,
    COLLECT_OPERATE,
    COLLECT_MANAGE,
    ASSET_VIEW,
    ASSET_MANAGE,
    dataset_catalog.DATASET_VIEW,
    dataset_catalog.DATASET_MANAGE,
    dataset_catalog.DATASET_RECORD_WRITE,
    dataset_catalog.DATASET_OVERRIDE,
    dataset_catalog.DATASET_BACKFILL,
    modeling_catalog.DATASET_RECORD_EXPORT,
    dataset_catalog.FORMULA_VIEW,
    dataset_catalog.FORMULA_MANAGE,
    modeling_catalog.MODELING_VIEW,
    modeling_catalog.MODELING_MANAGE,
    modeling_catalog.MODELING_RUN,
    modeling_catalog.MODELING_PUBLISH,
    LLM_VIEW,
    LLM_MANAGE,
)
# 命令总线的两档预算，固定住，断言里的信封才是可手写的常量
BROWSE_TIMEOUT_S = 10.0
COMMAND_TIMEOUT_S = 5.0
SUBTREE_TIMEOUT_S = 15.0
PLAN_CHANNEL = "collect:plan:changed"

# 大屏绑定用例引用的点位。⚠ 采集配置面未落地，故点位台账在用例里是一份名单假件
SEEDED_SOURCE_ID = "0192f0c0-0000-7000-8000-00000000abcd"
SEEDED_NODE_KEYS = frozenset(
    f"{SEEDED_SOURCE_ID}:{name}"
    for name in ("outlet_temp", "inlet_temp", "run_state")
)
# 用例里的源时区固定住，断言里的 UTC 时刻才是可手写的常量
SOURCE_TIMEZONE = "Asia/Shanghai"
# 默认几个形状齐备的对象，够既有的绑定用例用
SEEDED_OBJECTS = ("KTStartData_K01", "KTStartData_K02", "KTStartData_K03")

SignHeaders = Callable[..., dict[str, str]]


@pytest.fixture
def stream() -> InMemoryStream:
    """一条空的进程内流。"""
    return InMemoryStream()


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
def point_catalog() -> StaticPointCatalog:
    """点位台账假件：只认 `SEEDED_NODE_KEYS` 里那几条。"""
    return StaticPointCatalog(known_keys=SEEDED_NODE_KEYS)


@pytest.fixture
def ac_source() -> FakeAcSource:
    """假外库，默认已有几个形状齐备的对象与一段数据跨度。

    ⚠ 跨度是**本地时**：外库的 CT 列没有时区信息，换算由被测的
    `AcSourceReader` 做，用例因此仍然能拦住时区口径写错。
    """
    shape = full_shape()
    return FakeAcSource(
        columns={name: dict(shape) for name in SEEDED_OBJECTS},
        shaped_objects=list(SEEDED_OBJECTS),
        extent=[
            {
                # ⚠ 外库的 CT 列本来就是 naive 的当地时，假件必须照原样
                # 回，换算才轮得到被测的 AcSourceReader 去做
                "range_start": datetime(2023, 1, 1, 8, 0),  # noqa: DTZ001
                "range_end": datetime(2026, 8, 12, 8, 0),  # noqa: DTZ001
            }
        ],
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
                # ⚠ 与 `lib.db.Database.session` 同构：不跑钩子的话，报脏这类
                # 提交后副作用在用例里根本不发生，而它们在生产里是主路径
                await run_after_commit_hooks(session)

    return override


@dataclass
class AppContext:
    """整装应用的客户端与一个**同连接**的会话。

    ⚠ 两者必须共用一条连接：分开连就是两个事务，用例在会话里种下的数据在
    HTTP 那边根本看不见，而现象是「接口返回空列表」，看着像业务逻辑写错了。
    """

    client: httpx.AsyncClient
    session: AsyncSession
    """素材字节的进程内替身；用例据它断言「搬没搬」「删没删」。"""
    object_store: FakeObjectStore
    """台账报脏的进程内替身；用例据它断言「报没报脏」。"""
    dirty: FakeSetSink
    """回填的起跑口。⚠ 与应用同一个实例：端点用例据它看「起过没有」，
    而 `sessions` 就是用例那条回滚事务的会话工厂。"""
    backfill: BackfillRunner
    """用例那条回滚事务上的会话工厂。⚠ worker 侧的编排自己开短事务，用例要
    扮演一次 worker 就得把这个工厂交给它——另开一条连接的话，它看不见用例经
    HTTP 种下的数据，而现象是「运行说台账不存在」。"""
    sessions: MakerSessions


@dataclass(frozen=True)
class CollectFakes:
    """采集面那三跳跨进程调用的假件，一次性交给用例。"""

    bus: FakeCommandTransport
    plans: FakeChannelPublisher
    history: FakeHistorySource


@pytest.fixture
async def history_source(
    settings: Settings, postgres_available: bool
) -> AsyncIterator[ReadOnlyHistorySource]:
    """一条打真库的归档只读连接，用完就关。

    ⚠ 用真库而不是假件：它验的就是「这条连接真的只读」这条数据库层的事实，
    换成假件等于把要验的东西自己实现一遍。
    Args: settings, postgres_available。
    """
    if not postgres_available:
        pytest.skip("本机连不到 Postgres")
    # ⚠ search_path 与生产装配逐字相同（`container._build_history_database`）：
    # 少了扩展那一段，`time_bucket` / `last` / `first` 一个都解析不到，而用例
    # 里换成别的路径就会把这条真实的失败挡在外面
    database = Database(
        dsn=settings.dsn(),
        search_path=f"{HISTORY_SCHEMA},{TIMESCALE_SCHEMA}",
    )
    yield ReadOnlyHistorySource(database=database)
    await database.dispose()


@pytest.fixture
async def redis_url(settings: Settings) -> str:
    """测试用 Redis 的连接串。

    ⚠ 只探端口不够：本机常有一个**要口令**的 Redis 占着 6379，端口通而命令
    一律被拒。这里真发一次 PING，连不上就按环境能力缺失跳过。
    Args: settings。
    """
    url = settings.url()
    client = Redis.from_url(  # pyright: ignore[reportUnknownMemberType]
        url, socket_timeout=2, socket_connect_timeout=2
    )
    try:
        await client.ping()  # pyright: ignore[reportUnknownMemberType]
    except RedisError as error:
        pytest.skip(f"本机 Redis 不可用：{type(error).__name__}")
    finally:
        await client.aclose()
    return url


@pytest.fixture
async def viewer_source(
    settings: Settings, postgres_available: bool
) -> AsyncIterator[ReadOnlyViewerSource]:
    """一条打真库的订阅表只读连接，用完就关。

    ⚠ 用真库而不是假件：它验的就是「这条连接真的写不了别人的 schema」这条
    数据库层的事实，换成假件等于把要验的东西自己实现一遍。
    Args: settings, postgres_available。
    """
    if not postgres_available:
        pytest.skip("本机连不到 Postgres")
    database = Database(dsn=settings.dsn(), search_path=SUBSCRIPTION_SCHEMA)
    yield ReadOnlyViewerSource(database=database)
    await database.dispose()


@pytest.fixture
def collect_fakes() -> CollectFakes:
    """一组空的采集面假件。用例按需往里填预置应答。"""
    return CollectFakes(
        bus=FakeCommandTransport(),
        plans=FakeChannelPublisher(),
        history=FakeHistorySource(),
    )


@dataclass(frozen=True)
class ExternalFakes:
    """整装应用要替掉的全部跨进程依赖，打成一包。

    ⚠ 打成一包不是为了好看：fixture 的形参上限与函数一样是 5，而
    `app_context` 还要 settings / 可达性 / 签名器三件。
    """

    ac_source: FakeAcSource
    points: StaticPointCatalog
    collect: CollectFakes
    nodes: FakeNodeWriter
    dirty: FakeSetSink


@pytest.fixture
def dirty_sink() -> FakeSetSink:
    """台账报脏用的进程内集合。"""
    return FakeSetSink()


@pytest.fixture
def external_fakes(
    ac_source: FakeAcSource,
    point_catalog: StaticPointCatalog,
    collect_fakes: CollectFakes,
    node_writer: FakeNodeWriter,
    dirty_sink: FakeSetSink,
) -> ExternalFakes:
    """把五组假件收成一包给 `app_context`。

    Args: ac_source, point_catalog, collect_fakes, node_writer, dirty_sink。
    """
    return ExternalFakes(
        ac_source=ac_source,
        points=point_catalog,
        collect=collect_fakes,
        nodes=node_writer,
        dirty=dirty_sink,
    )


@pytest.fixture
def node_writer() -> FakeNodeWriter:
    """假下发面。默认一个节点都没有——要绑点位的用例自己 `add`。"""
    return FakeNodeWriter()


def _wire_fakes(
    application: FastAPI,
    *,
    maker: async_sessionmaker[AsyncSession],
    fakes: ExternalFakes,
    validation: ValidationContext,
    object_store: FakeObjectStore,
) -> None:
    """把会打网络的依赖换成假件。

    ⚠ 事务件只有一份（`platform_server.deps.get_session`），换一次就够。
    它此前是每个功能模块各一份、五份都要换，而 `runtime_params` 那份漏过一次，
    表现是「单跑绿、连着跑红」——那个模块打真库真提交，残留行躺在库里毒下一次
    运行。收成一份之后这类漏换不可能再发生，由
    `tests/contract/test_route_matrix.py` 守住不许再分叉。
    Args: application, maker, fakes, validation, object_store。
    """
    application.dependency_overrides[get_session] = _session_override(maker)
    application.dependency_overrides[get_object_store] = lambda: object_store
    application.dependency_overrides[get_ac_source_reader] = lambda: (
        AcSourceReader(source=fakes.ac_source, timezone=SOURCE_TIMEZONE)
    )
    application.dependency_overrides[get_node_writer] = lambda: fakes.nodes
    # 自己开短事务的那两个口都换成用例这条。⚠ 漏换一个的表现是它另开一条
    # 连接，看不见用例种下的数据——而那一侧只会静默地记不上
    for opener in (get_sessions, get_modeling_sessions):
        application.dependency_overrides[opener] = lambda: MakerSessions(maker)
    application.dependency_overrides[get_dashboard_validation_context] = (
        lambda: validation
    )


def _faked_container(
    built: Container, fakes: ExternalFakes, sessions: MakerSessions
) -> Container:
    """把会打网络的长生命周期对象换成进程内假件。

    ⚠ 用例不许打网络，而 Redis 与归档库在 CI 里也不存在。
    ⚠ 回填的起跑口换成**只记不跑**的替身：用例那条会话是一条回滚事务上的
    单连接，后台任务会在同一条连接上另开短事务，一交错就是
    `PendingRollbackError`。真跑一遍回填由 `integration` 那一批用例自建起跑口
    验（`backfill_helpers.Backfiller`）。
    Args: built, fakes, sessions。
    """
    dirty = DatasetDirtyLog(sink=fakes.dirty)
    return replace(
        built,
        dataset=replace(
            built.dataset,
            dirty=dirty,
            backfill=RecordingRunner(
                sessions=sessions,
                history=fakes.collect.history,
                dirty=dirty,
                jobs=BackfillJobs(store=InMemoryCache()),
                settings=built.settings,
            ),
        ),
        nodes=fakes.nodes,
        idempotency=IdempotencyStore(
            cache=InMemoryCache(), namespace=IDEMPOTENCY_NAMESPACE
        ),
        command_bus=CommandBus(
            transport=fakes.collect.bus,
            browse_timeout_s=BROWSE_TIMEOUT_S,
            command_timeout_s=COMMAND_TIMEOUT_S,
            subtree_timeout_s=SUBTREE_TIMEOUT_S,
        ),
        plan_notifier=PlanNotifier(
            publisher=fakes.collect.plans, channel=PLAN_CHANNEL
        ),
        history=fakes.collect.history,
    )


@pytest.fixture
async def app_context(
    settings: Settings,
    postgres_available: bool,
    sign: SignHeaders,
    external_fakes: ExternalFakes,
) -> AsyncIterator[AppContext]:
    """整装应用 + 同连接的会话，每条用例一个回滚事务。

    ⚠ 外库与 Redis 一律换成假件：用例不许打网络，而它们在 CI 里也不存在。
    """
    if not postgres_available:
        pytest.skip("本机连不到 Postgres")
    application = build_app(settings)
    connection = await application.state.container.database.engine.connect()
    transaction = await connection.begin()
    maker = rollback_sessions(connection)
    container = _faked_container(
        application.state.container, external_fakes, MakerSessions(maker)
    )
    application.state.container = container
    object_store = FakeObjectStore()
    _wire_fakes(
        application,
        maker=maker,
        fakes=external_fakes,
        validation=ValidationContext(
            catalog=container.module_catalog, points=external_fakes.points
        ),
        object_store=object_store,
    )
    transport = httpx.ASGITransport(app=application)
    async with (
        httpx.AsyncClient(
            transport=transport, base_url="http://platform-test", timeout=30
        ) as client,
        maker() as session,
    ):
        client.headers.update(sign())
        yield AppContext(
            client=client,
            session=session,
            object_store=object_store,
            dirty=external_fakes.dirty,
            backfill=container.dataset.backfill,
            sessions=MakerSessions(maker),
        )

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


@pytest.fixture
async def worker_sessions(app_context: AppContext) -> MakerSessions:
    """扮演 worker 时用的会话工厂，与 HTTP 那侧共用同一条连接。"""
    return app_context.sessions


@pytest.fixture
async def dirty_marks(app_context: AppContext) -> FakeSetSink:
    """与应用同一个报脏替身。

    ⚠ 与 `app_client` 必须是同一个实例：各造一个的话，用例断言的是一个从来
    没被应用碰过的空集合，而断言「没报脏」会恒真。
    """
    return app_context.dirty


@pytest.fixture
async def object_store(app_context: AppContext) -> FakeObjectStore:
    """与应用同一个字节面替身。

    ⚠ 与 `app_client` 必须是同一个实例：各造一个的话，用例断言的是一个
    从来没被应用碰过的空桶，而断言「没搬过去」会恒真。
    """
    return app_context.object_store
