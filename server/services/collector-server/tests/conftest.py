"""全局 fixture 与共用假件。

⚠ 用例里不要 `from tests.conftest import ...`：workspace 里每个服务都有一个
顶层 `tests` 包，那条 import 会解析到别的服务的 conftest。
L2 打真实 Postgres / Redis，本机连不到就跳过那一层（能力缺失才允许 skip）。
"""

import asyncio
import os
import socket
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from typing import Any
from uuid import UUID, uuid4

import pytest
from pydantic import SecretStr
from redis.asyncio import Redis
from redis.exceptions import RedisError

from collector_server.apps.collect.drivers.base import (
    BrowseItem,
    BrowseNotSupported,
    DriverCapabilities,
    PointSpec,
    RejectedPoint,
    Sample,
    SubscribeResult,
    ValueSink,
)
from collector_server.apps.collect.runtime.session import SourceStatus
from collector_server.settings import Settings
from collector_server.stream import StreamEntry, stream_key
from collectwire import (
    CollectPlan,
    PlanPoint,
    PlanSource,
)
from lib.db import Database, PoolProfile
from lib.logging import configure_logging

# 只在测试进程里存在的取值，与任何环境的真实配置无关
TEST_SERVICE_KEY = "collector-test-service-key-0123456789ab"
SOURCE_ID = UUID("0192f000-0000-7000-8000-000000000001")

PointFactory = Callable[..., PlanPoint]
SourceFactory = Callable[..., PlanSource]
PlanFactory = Callable[..., CollectPlan]


@pytest.fixture(scope="session", autouse=True)
def _logging() -> None:
    configure_logging(
        service="collector-server",
        role="test",
        instance="test",
        level="ERROR",
        log_format="json",
    )


@pytest.fixture
def settings() -> Settings:
    """一份不依赖环境变量的配置。"""
    return Settings(
        postgres_host="localhost",
        postgres_user="collector",
        postgres_password=SecretStr("collector"),
        postgres_db="collector",
        redis_host="localhost",
        edge_service_key=SecretStr(TEST_SERVICE_KEY),
    )


def _reachable(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=2):
            return True
    except OSError:
        return False


def _env_settings() -> Settings:
    """按环境变量拼一份配置，缺的取本地默认值。"""
    return Settings(
        postgres_host=os.getenv("COLLECT_POSTGRES_HOST", "localhost"),
        postgres_port=int(os.getenv("COLLECT_POSTGRES_PORT", "5432")),
        postgres_user=os.getenv("COLLECT_POSTGRES_USER", "dt"),
        postgres_password=SecretStr(
            os.getenv("COLLECT_POSTGRES_PASSWORD", "dt")
        ),
        postgres_db=os.getenv("COLLECT_POSTGRES_DB", "dt"),
        redis_host=os.getenv("COLLECT_REDIS_HOST", "localhost"),
        redis_port=int(os.getenv("COLLECT_REDIS_PORT", "6379")),
        redis_password=(
            SecretStr(os.environ["COLLECT_REDIS_PASSWORD"])
            if os.getenv("COLLECT_REDIS_PASSWORD")
            else None
        ),
        edge_service_key=SecretStr(TEST_SERVICE_KEY),
    )


@pytest.fixture(scope="session")
def live_settings() -> Settings:
    """指向本机测试依赖的配置。"""
    return _env_settings()


@pytest.fixture
async def redis_url(live_settings: Settings) -> str:
    """测试用 Redis 的连接串。

    ⚠ 只探端口不够：本机常有一个**要口令**的 Redis 占着 6379，端口通而
    命令一律被拒。这里真发一次 PING，连不上就按环境能力缺失跳过。

    Args: live_settings。
    """
    url = live_settings.url()
    client = Redis.from_url(url, socket_timeout=2, socket_connect_timeout=2)
    try:
        await client.ping()
    except RedisError as error:
        pytest.skip(f"本机 Redis 不可用：{type(error).__name__}")
    finally:
        await client.aclose()
    return url


@pytest.fixture
async def database(live_settings: Settings) -> AsyncIterator[Database]:
    """连得上测试库的句柄；连不上就跳过。

    Args: live_settings。
    """
    if not _reachable(live_settings.postgres_host, live_settings.postgres_port):
        pytest.skip("本机连不到 Postgres")
    opened = Database(
        dsn=live_settings.dsn(),
        profile=PoolProfile(),
        search_path=live_settings.postgres_schema,
    )
    if not await opened.ping():
        await opened.dispose()
        pytest.skip("本机 Postgres 连得上但用不了（凭据或库不对）")
    yield opened
    await opened.dispose()


def make_point(code: str = "outlet_temp", **overrides: object) -> PlanPoint:
    """造一个计划里的点位。

    Args: code, **overrides。
    """
    fields: dict[str, object] = {
        "point_code": code,
        "address": f"ns=2;s={code}",
        "sampling_interval_ms": 1000,
    }
    fields.update(overrides)
    return PlanPoint.model_validate(fields)


def make_source(source_id: UUID = SOURCE_ID, **overrides: object) -> PlanSource:
    """造一个计划里的数据源。

    Args: source_id, **overrides。
    """
    fields: dict[str, object] = {
        "source_id": source_id,
        "code": "line-1",
        "protocol": "opcua",
        "endpoint": "opc.tcp://127.0.0.1:4840/line-1",
        "points": (make_point(),),
    }
    fields.update(overrides)
    return PlanSource.model_validate(fields)


def make_plan(version: str = "v1", **overrides: object) -> CollectPlan:
    """造一份计划。

    Args: version, **overrides。
    """
    fields: dict[str, object] = {
        "version": version,
        "sources": (make_source(),),
    }
    fields.update(overrides)
    return CollectPlan.model_validate(fields)


class StaticPlan:
    """`PlanView` 的假件：手里攥着一份不会自己更新的计划。"""

    def __init__(self, plan: CollectPlan | None = None) -> None:
        self._plan = plan

    @property
    def current(self) -> CollectPlan | None:
        return self._plan

    def replace(self, plan: CollectPlan) -> None:
        """换一份计划，模拟 platform 下发了新版本。"""
        self._plan = plan


class FakeArchiveStream:
    """满足 `ArchiveStream` 的进程内假件，可按需让每一步失败。"""

    def __init__(self, *, length: int = 1) -> None:
        self.entries: dict[str, list[StreamEntry]] = {}
        self.appended: list[tuple[UUID, list[Mapping[str, object]]]] = []
        self.deleted: list[tuple[str, tuple[str, ...]]] = []
        self.maxlens: list[int] = []
        self.length = length
        self.append_error: Exception | None = None
        self.keys_error: Exception | None = None
        self.read_error: Exception | None = None
        self.delete_error: Exception | None = None
        self._next_id = 0

    def load(
        self, source_id: UUID, rows: Sequence[Mapping[str, object]]
    ) -> str:
        """直接塞一条条目进去，返回它的 id。"""
        self._next_id += 1
        entry_id = f"{self._next_id}-0"
        key = stream_key(source_id)
        self.entries.setdefault(key, []).append(
            StreamEntry(entry_id=entry_id, rows=tuple(rows))
        )
        return entry_id

    async def append(
        self,
        source_id: UUID,
        rows: Sequence[Mapping[str, object]],
        *,
        maxlen: int,
    ) -> int:
        if self.append_error is not None:
            raise self.append_error
        self.appended.append((source_id, list(rows)))
        self.maxlens.append(maxlen)
        self.load(source_id, rows)
        return self.length

    async def keys(self) -> list[str]:
        if self.keys_error is not None:
            raise self.keys_error
        return sorted(self.entries)

    async def read(self, key: str, *, count: int) -> list[StreamEntry]:
        if self.read_error is not None:
            raise self.read_error
        return self.entries.get(key, [])[:count]

    async def delete(self, key: str, entry_ids: Sequence[str]) -> int:
        if self.delete_error is not None:
            raise self.delete_error
        self.deleted.append((key, tuple(entry_ids)))
        kept = [
            entry
            for entry in self.entries.get(key, [])
            if entry.entry_id not in set(entry_ids)
        ]
        self.entries[key] = kept
        return len(entry_ids)

    async def close(self) -> None:
        return None


class RecordingStore:
    """满足 `HistoryStore` 的进程内假件：只记下写了哪些行。"""

    def __init__(self) -> None:
        self.batches: list[list[Mapping[str, Any]]] = []
        self.error: Exception | None = None

    @property
    def rows(self) -> list[Mapping[str, Any]]:
        """按顺序摊平的全部行。"""
        return [row for batch in self.batches for row in batch]

    async def store(self, rows: Sequence[Mapping[str, Any]]) -> int:
        if self.error is not None:
            raise self.error
        self.batches.append(list(rows))
        return len(rows)


class RecordingReporter:
    """记下每一次运行态上报。"""

    def __init__(self) -> None:
        self.reported: list[SourceStatus] = []
        # 用事件而不是轮询等：慢机器上「睡一小会儿再看」必然偶发失败
        self.has_reported = asyncio.Event()

    async def report(self, status: SourceStatus) -> None:
        self.reported.append(status)
        self.has_reported.set()

    def states(self) -> list[str]:
        """按顺序取上报过的状态名。"""
        return [status.state for status in self.reported]


class FakeDriver:
    """满足 `Driver` 的进程内假件，可按需让每一步失败。"""

    def __init__(
        self,
        *,
        capabilities: DriverCapabilities | None = None,
        connect_error: Exception | None = None,
        heartbeat_error: Exception | None = None,
    ) -> None:
        self.capabilities = capabilities or DriverCapabilities(
            is_subscribe_supported=True,
            is_browse_supported=True,
            is_write_supported=True,
        )
        self.connect_error = connect_error
        self.heartbeat_error = heartbeat_error
        self.loaded: list[str] = []
        self.subscribed: list[str] = []
        self.unsubscribed: list[str] = []
        self.reads: list[tuple[str, ...]] = []
        self.writes: list[tuple[str, object]] = []
        self.rejected: tuple[RejectedPoint, ...] = ()
        self.samples: list[Sample] = []
        self.items: list[BrowseItem] = []
        self.is_connected = False
        self.sink: ValueSink | None = None
        self.browsed: list[str | None] = []
        self.classified: list[BaseException] = []
        # 用事件而不是轮询等：慢机器上「睡一小会儿再看」必然偶发失败
        self.has_polled = asyncio.Event()

    def load_points(self, points: list[PointSpec]) -> None:
        self.loaded = [point.point_code for point in points]

    async def connect(self) -> None:
        if self.connect_error is not None:
            raise self.connect_error
        self.is_connected = True

    async def disconnect(self) -> None:
        self.is_connected = False

    async def healthcheck(self) -> None:
        if self.heartbeat_error is not None:
            raise self.heartbeat_error

    async def subscribe(
        self, points: list[PointSpec], on_value: ValueSink
    ) -> SubscribeResult:
        # ⚠ 被拒的点位不许进 accepted：真驱动就是这个形状
        # （opcua/driver.py 的 merge_handles），假件放宽的话「没订上几个」
        # 这条口径在测试里会永远对得上
        self.sink = on_value
        codes = [point.point_code for point in points]
        self.subscribed.extend(codes)
        refused = {item.point_code for item in self.rejected}
        return SubscribeResult(
            accepted=tuple(code for code in codes if code not in refused),
            rejected=self.rejected,
        )

    async def unsubscribe(self, point_codes: list[str]) -> int:
        self.unsubscribed.extend(point_codes)
        return len(point_codes)

    async def read_many(self, point_codes: list[str]) -> list[Sample]:
        self.reads.append(tuple(point_codes))
        self.has_polled.set()
        return self.samples

    async def write(self, point_code: str, value: object) -> None:
        self.writes.append((point_code, value))

    async def browse(self, parent: str | None) -> list[BrowseItem]:
        self.browsed.append(parent)
        if not self.capabilities.is_browse_supported:
            raise BrowseNotSupported("本协议没有地址空间")
        return self.items

    def fingerprint(self) -> tuple[str, ...]:
        return ("fake",)

    def classify_error(self, error: BaseException) -> str:
        self.classified.append(error)
        return "transient"


@pytest.fixture
def driver() -> FakeDriver:
    """一个默认全都成功的假驱动。"""
    return FakeDriver()


@pytest.fixture
def build_driver() -> type[FakeDriver]:
    """假驱动的构造器，给要定制失败的用例。

    ⚠ 经 fixture 传而不是 `from tests.conftest import`：workspace 里每个服务
    都有一个顶层 `tests` 包，那条 import 会解析到别的服务的 conftest。
    """
    return FakeDriver


@pytest.fixture
def build_point() -> PointFactory:
    """计划点位的构造器。"""
    return make_point


@pytest.fixture
def build_source() -> SourceFactory:
    """计划数据源的构造器。"""
    return make_source


@pytest.fixture
def build_plan() -> PlanFactory:
    """采集计划的构造器。"""
    return make_plan


@pytest.fixture
def reporter() -> RecordingReporter:
    """记录运行态上报的假件。"""
    return RecordingReporter()


@pytest.fixture
def source_id() -> UUID:
    """一个用例里稳定、用例之间互不相同的数据源 id。"""
    return uuid4()


@pytest.fixture
def archive_stream() -> FakeArchiveStream:
    """一条默认全都成功的假归档流。"""
    return FakeArchiveStream()


@pytest.fixture
def history_store() -> RecordingStore:
    """记录落库调用的假件。"""
    return RecordingStore()


@pytest.fixture
def build_plan_view() -> type[StaticPlan]:
    """`PlanView` 假件的构造器。

    ⚠ 经 fixture 传而不是 `from tests.conftest import`：workspace 里每个服务
    都有一个顶层 `tests` 包，那条 import 会解析到别的服务的 conftest。
    """
    return StaticPlan
