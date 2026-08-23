"""清理循环的单活、开关与执行锚点。

⚠ 这一组守的是四件「没人会报错」的事：没租约的那一趟不许碰库；开关关着一行都
不许删；**拨开开关之后必须等满一个完整周期**（否则一个关了一年的库会在下一次
醒来时掉一大片）；一张表出错不许带走同一趟里其余的表。
"""

import asyncio
import contextlib
import uuid
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lib.testing import InMemoryCache
from platform_server.apps.dataset.services import retention as loop_module
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from platform_server.apps.dataset.services.retention import (
    ANCHOR_KEY,
    DatasetRetention,
    RetentionAnchor,
    RetentionContext,
    knobs_of,
)
from platform_server.apps.dataset.services.retention_run import (
    Budget,
    RetentionJob,
    SweepResult,
)
from platform_server.apps.runtime_params import catalog
from platform_server.lease import Lease
from platform_server.settings import Settings
from unit.dataset_fakes import FakeSetSink
from unit.publish_fakes import FakeLease
from unit.wiring_fakes import build_settings

NOW = datetime(2026, 8, 24, 3, 0, tzinfo=UTC)
DAY = timedelta(days=1)
FIRST = RetentionJob(
    table_id=uuid.UUID("0192f0c0-0000-7000-8000-0000000000c1"),
    code="first",
    retention_days=30,
)
SECOND = RetentionJob(
    table_id=uuid.UUID("0192f0c0-0000-7000-8000-0000000000c2"),
    code="second",
    retention_days=90,
)


@dataclass
class SpySessions:
    """记下开过几次会话；本组用例不碰真库。"""

    opened: int = 0

    @contextlib.asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        self.opened += 1
        yield cast(AsyncSession, None)


@dataclass
class SpySweeps:
    """替掉逐表清理，记下删过哪几张表、并按需在某张表上抛。"""

    seen: list[str] = field(default_factory=list[str])
    failures: set[str] = field(default_factory=set[str])
    rows_each: int = 5
    spans: list[tuple[datetime, datetime]] = field(
        default_factory=list[tuple[datetime, datetime]]
    )
    reindex_calls: list[tuple[datetime, datetime]] = field(
        default_factory=list[tuple[datetime, datetime]]
    )
    #: 第一张表被删到时置位，用例据它等到「循环真的转起来了」
    touched: asyncio.Event = field(default_factory=asyncio.Event)

    async def sweep_table(
        self,
        _sessions: object,
        job: RetentionJob,
        *,
        now: datetime,
        budget: Budget,
    ) -> SweepResult:
        self.seen.append(job.code)
        self.touched.set()
        if job.code in self.failures:
            raise RuntimeError("这张表删不动")
        budget.add(self.rows_each)
        span = (now - timedelta(days=40), now - timedelta(days=30))
        self.spans.append(span)
        return SweepResult(
            rows=self.rows_each, span=span if self.rows_each else None
        )

    async def reindex_span(
        self, _sessions: object, *, span: tuple[datetime, datetime]
    ) -> int:
        self.reindex_calls.append(span)
        return 1


@dataclass
class Wired:
    """一条装好假件的清理循环，连同用例要看的那几个观测点。"""

    loop: DatasetRetention
    sessions: SpySessions
    sweeps: SpySweeps
    lease: FakeLease
    cache: InMemoryCache
    dirty: FakeSetSink
    settings: Settings


def make_context(
    sessions: SpySessions,
    cache: InMemoryCache,
    dirty: FakeSetSink,
    settings: Settings,
) -> RetentionContext:
    """一份不连任何网络的循环协作者。

    Args: sessions, cache, dirty, settings。
    """
    return RetentionContext(
        database=sessions,
        anchor=RetentionAnchor(store=cache),
        dirty=DatasetDirtyLog(sink=dirty),
        settings=settings,
    )


@pytest.fixture
def wired(monkeypatch: pytest.MonkeyPatch) -> Wired:
    """一条把租约、会话、逐表清理与「此刻」全部换掉的循环。

    Args: monkeypatch。
    """
    sessions = SpySessions()
    sweeps = SpySweeps()
    cache = InMemoryCache()
    dirty = FakeSetSink()
    lease = FakeLease()
    settings = build_settings()
    monkeypatch.setattr(loop_module, "sweep_table", sweeps.sweep_table)
    monkeypatch.setattr(loop_module, "reindex_span", sweeps.reindex_span)
    stub_jobs(monkeypatch, [FIRST, SECOND])
    stub_knobs(monkeypatch, {"dataset_retention_enabled": True})
    stub_now(monkeypatch, NOW)
    return Wired(
        loop=DatasetRetention(
            context=make_context(sessions, cache, dirty, settings),
            lease=cast(Lease, lease),
        ),
        sessions=sessions,
        sweeps=sweeps,
        lease=lease,
        cache=cache,
        dirty=dirty,
        settings=settings,
    )


def stub_jobs(
    monkeypatch: pytest.MonkeyPatch, jobs: list[RetentionJob]
) -> None:
    """把「有哪几张台账配了保留期」换成一份名单。

    Args: monkeypatch, jobs。
    """

    async def load_jobs(_sessions: object) -> list[RetentionJob]:
        return list(jobs)

    monkeypatch.setattr(loop_module, "load_jobs", load_jobs)


def stub_knobs(
    monkeypatch: pytest.MonkeyPatch, values: Mapping[str, object]
) -> None:
    """把运行参数的有效值换成一份字典。

    Args: monkeypatch, values。
    """

    async def effective_values(
        _session: object, *, settings: Settings, section: str
    ) -> dict[str, object]:
        del settings, section
        return dict(values)

    monkeypatch.setattr(
        loop_module.param_service, "effective_values", effective_values
    )


def stub_now(monkeypatch: pytest.MonkeyPatch, moment: datetime) -> None:
    """把「此刻」钉住，好让周期是可手写的常量。

    Args: monkeypatch, moment。
    """
    monkeypatch.setattr(loop_module, "utcnow", lambda: moment)


async def test_a_tick_without_the_lease_never_opens_a_session(
    wired: Wired,
) -> None:
    wired.lease.is_grantable = False
    await wired.loop.tick()
    assert wired.loop.is_leader is False
    assert wired.sessions.opened == 0
    assert wired.sweeps.seen == []


async def test_losing_the_lease_stops_the_very_next_tick(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    # ⚠ renew-or-die：续不上还接着删，就是两个副本各自解压同一批压缩块
    await wired.loop.tick()
    stub_now(monkeypatch, NOW + DAY)
    wired.lease.is_renewable = False
    await wired.loop.tick()
    assert wired.loop.is_leader is False
    assert wired.sweeps.seen == []


async def test_the_switch_off_deletes_nothing_and_drops_the_anchor(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    """⚠ 关着的时候必须把锚点抹掉，理由见下一条用例。"""
    await wired.loop.tick()
    assert ANCHOR_KEY in wired.cache.store
    stub_knobs(monkeypatch, {"dataset_retention_enabled": False})
    await wired.loop.tick()
    assert ANCHOR_KEY not in wired.cache.store
    assert wired.sweeps.seen == []


async def test_the_first_tick_with_the_switch_on_only_anchors(
    wired: Wired,
) -> None:
    # ⚠ 拨开开关的那一趟一行都不删：留出整整一个周期的反悔余地
    await wired.loop.tick()
    assert wired.sweeps.seen == []
    assert wired.cache.store[ANCHOR_KEY] != ""


async def test_it_still_waits_when_the_period_has_not_elapsed(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    await wired.loop.tick()
    stub_now(monkeypatch, NOW + timedelta(hours=23))
    await wired.loop.tick()
    assert wired.sweeps.seen == []


async def test_it_sweeps_once_a_full_period_has_elapsed(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    await wired.loop.tick()
    stub_now(monkeypatch, NOW + DAY)
    await wired.loop.tick()
    assert wired.sweeps.seen == ["first", "second"]


async def test_a_switch_off_for_a_year_never_sweeps_on_the_tick_after_it_is_on(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    """⚠ 这条用例守的是本模块最要紧的一件事。

    锚点若只在「真跑过」之后推进、而关着的那些趟原样留着，那么一个关了一年的
    库在重新拨开开关的下一次醒来时就会立刻开删——因为「上次执行」已经是一年
    以前。抹掉锚点换来的是：拨开之后总有整整一个周期的余地。
    """
    await wired.loop.tick()
    stub_now(monkeypatch, NOW + DAY)
    await wired.loop.tick()
    assert wired.sweeps.seen == ["first", "second"]
    # 关掉一年，期间照常醒来
    stub_knobs(monkeypatch, {"dataset_retention_enabled": False})
    for days in (2, 200, 365):
        stub_now(monkeypatch, NOW + timedelta(days=days))
        await wired.loop.tick()
    # 一年后重新拨开：这一趟只锚定
    stub_knobs(monkeypatch, {"dataset_retention_enabled": True})
    stub_now(monkeypatch, NOW + timedelta(days=366))
    await wired.loop.tick()
    assert wired.sweeps.seen == ["first", "second"]
    # 再等满一个周期才真的删
    stub_now(monkeypatch, NOW + timedelta(days=367))
    await wired.loop.tick()
    assert wired.sweeps.seen == ["first", "second", "first", "second"]


async def test_the_anchor_advances_only_after_a_run_that_really_happened(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    await wired.loop.tick()
    anchored = wired.cache.store[ANCHOR_KEY]
    stub_now(monkeypatch, NOW + timedelta(hours=1))
    await wired.loop.tick()
    # 没到点的那些趟原地不动——每趟都推的话，周期永远走不满
    assert wired.cache.store[ANCHOR_KEY] == anchored
    stub_now(monkeypatch, NOW + DAY)
    await wired.loop.tick()
    assert wired.cache.store[ANCHOR_KEY] != anchored


async def test_an_unreadable_anchor_is_treated_as_not_anchored(
    wired: Wired,
) -> None:
    # 读不出来就重新锚定、再等一个周期——这个方向是安全的
    wired.cache.store[ANCHOR_KEY] = '"这不是一个时刻"'
    await wired.loop.tick()
    assert wired.sweeps.seen == []


async def test_a_table_that_blows_up_does_not_take_the_others_with_it(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    wired.sweeps.failures.add("first")
    await wired.loop.tick()
    stub_now(monkeypatch, NOW + DAY)
    await wired.loop.tick()
    assert wired.sweeps.seen == ["first", "second"]


async def test_a_swept_table_is_reported_dirty(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    # ⚠ 删行同样会改这张表读出来的东西：不报脏，大屏会静默停在旧数上
    await wired.loop.tick()
    stub_now(monkeypatch, NOW + DAY)
    await wired.loop.tick()
    assert wired.dirty.members("platform:dataset:dirty") == {
        "first",
        "second",
    }


async def test_a_table_that_lost_no_rows_is_not_reported_dirty(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    wired.sweeps.rows_each = 0
    await wired.loop.tick()
    stub_now(monkeypatch, NOW + DAY)
    await wired.loop.tick()
    assert wired.dirty.members("platform:dataset:dirty") == set()


async def test_the_row_budget_stops_the_run_between_tables(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    """⚠ 触顶要响亮：静默截断会让人以为保留期已经完全生效了。"""
    events: list[str] = []
    monkeypatch.setattr(
        loop_module._logger,  # pyright: ignore[reportPrivateUsage]
        "warning",
        lambda event, *_args, **_kwargs: events.append(event),
    )
    stub_knobs(
        monkeypatch,
        {
            "dataset_retention_enabled": True,
            "dataset_retention_max_rows_per_run": 1,
        },
    )
    await wired.loop.tick()
    stub_now(monkeypatch, NOW + DAY)
    await wired.loop.tick()
    assert wired.sweeps.seen == ["first"]
    assert "dataset_retention_capped" in events


async def test_the_index_is_only_reclaimed_when_rows_were_really_deleted(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    wired.sweeps.rows_each = 0
    await wired.loop.tick()
    stub_now(monkeypatch, NOW + DAY)
    await wired.loop.tick()
    assert wired.sweeps.reindex_calls == []


async def test_the_index_is_reclaimed_over_the_widest_span_swept(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    # ⚠ 压缩块上的 DML 让索引涨到 29 倍，而 VACUUM 一个字节都收不回来
    await wired.loop.tick()
    stub_now(monkeypatch, NOW + DAY)
    await wired.loop.tick()
    assert len(wired.sweeps.reindex_calls) == 1
    assert wired.sweeps.reindex_calls[0] == wired.sweeps.spans[0]


async def test_stopping_mid_run_skips_the_remaining_tables(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 关停第一步是「停收新活」：手上这张删完，后面的不再开始
    await wired.loop.tick()
    original = wired.sweeps.sweep_table

    async def stop_after_first(*args: object, **kwargs: object) -> SweepResult:
        wired.loop.stop()
        return await original(
            *args, **kwargs
        )  # pyright: ignore[reportArgumentType, reportCallIssue]

    monkeypatch.setattr(loop_module, "sweep_table", stop_after_first)
    stub_now(monkeypatch, NOW + DAY)
    await wired.loop.tick()
    assert wired.sweeps.seen == ["first"]


async def test_the_lease_is_only_handed_back_when_it_is_held(
    wired: Wired,
) -> None:
    await wired.loop.release()
    assert "release" not in wired.lease.ledger
    await wired.loop.tick()
    await wired.loop.release()
    assert wired.lease.ledger.count("release") == 1
    assert wired.loop.is_leader is False


async def test_draining_returns_at_once_when_no_run_is_in_flight(
    wired: Wired,
) -> None:
    # ⚠ 等满预算会把关停拖成那么久，而编排器的宽限期是有限的
    loop = asyncio.get_running_loop()
    started = loop.time()
    await wired.loop.drain(30.0)
    assert loop.time() - started < 1.0


async def test_the_loop_exits_after_it_is_told_to_stop(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    # ⚠ `_pause` 要被叫停唤醒，而不是傻等一整天——那会把关停拖过宽限期
    stub_knobs(
        monkeypatch,
        {
            "dataset_retention_enabled": True,
            "dataset_retention_interval_s": 0.01,
        },
    )
    # 先把锚点写到一个周期以前，好让循环第一趟就真的去删
    await RetentionAnchor(store=wired.cache).write(NOW - DAY)
    task = asyncio.create_task(wired.loop.run())
    try:
        await asyncio.wait_for(wired.sweeps.touched.wait(), timeout=5.0)
    finally:
        wired.loop.stop()
    await asyncio.wait_for(task, timeout=5.0)
    assert task.done()
    assert wired.sweeps.seen[0] == "first"


async def test_a_failing_tick_does_not_take_the_loop_down(
    wired: Wired, monkeypatch: pytest.MonkeyPatch
) -> None:
    """一趟出错只该丢掉那一趟。

    ⚠ 带走整个循环的话，它就再也不续租约、也不再清理，而进程还活着——这是
    最难察觉的一种停摆。
    Args: wired, monkeypatch。
    """
    stub_knobs(
        monkeypatch,
        {
            "dataset_retention_enabled": True,
            "dataset_retention_interval_s": 0.01,
        },
    )
    asked: list[int] = []

    async def flaky(_sessions: object) -> list[RetentionJob]:
        asked.append(1)
        if len(asked) == 1:
            raise RuntimeError("库抖了一下")
        return [FIRST]

    # 第一趟只锚定，故先把锚点写到一个周期以前
    await wired.loop.tick()
    monkeypatch.setattr(loop_module, "load_jobs", flaky)
    monkeypatch.setattr(loop_module, "utcnow", lambda: NOW + DAY)
    task = asyncio.create_task(wired.loop.run())
    try:
        await asyncio.wait_for(wired.sweeps.touched.wait(), timeout=5.0)
    finally:
        wired.loop.stop()
    await asyncio.wait_for(task, timeout=5.0)
    assert len(asked) >= 2
    assert wired.sweeps.seen == ["first"]


@pytest.mark.parametrize("given", ["很久", True, None])
def test_a_knob_of_the_wrong_shape_falls_back_to_the_environment(
    given: object,
) -> None:
    """形状不对时回落到环境变量而不是拿一个 0 去跑。

    ⚠ `True` 尤其要挡——bool 是 int 的子类，不挡就会有一个 `true` 悄悄变成
    1 秒一趟的清理。
    Args: given。
    """
    settings = build_settings()
    knobs = knobs_of({"dataset_retention_interval_s": given}, settings)
    assert knobs.interval_s == settings.dataset_retention_interval_s


def test_the_switch_defaults_to_off_when_nothing_overrides_it() -> None:
    # ⚠ 默认关：打开它才是危险的那一侧
    settings = build_settings()
    assert settings.dataset_retention_enabled is False
    assert knobs_of({}, settings).is_enabled is False


def test_the_knobs_prefer_the_override_over_the_environment() -> None:
    settings = build_settings()
    knobs = knobs_of(
        {
            "dataset_retention_enabled": True,
            "dataset_retention_max_rows_per_run": 7,
        },
        settings,
    )
    assert knobs.is_enabled is True
    assert knobs.max_rows_per_run == 7


def test_the_lease_outlives_the_longest_period_the_ui_can_ask_for() -> None:
    """⚠ 续期只发生在每一趟醒来时：TTL 比周期还短就是每趟都先丢租约。"""
    spec = catalog.spec_of(
        catalog.SECTION_DATASET, "dataset_retention_interval_s"
    )
    assert spec is not None
    assert build_settings().dataset_retention_lease_ttl_s > spec.maximum


async def test_the_anchor_survives_a_write_failure_without_raising() -> None:
    """控制面抖一下不该让清理循环崩掉。"""

    @dataclass
    class BrokenStore:
        async def get_json(self, key: str) -> object | None:
            del key
            raise RuntimeError("缓存挂了")

        async def set_json(
            self, key: str, value: object, *, ttl_s: int
        ) -> None:
            del key, value, ttl_s
            raise RuntimeError("缓存挂了")

        async def delete(self, key: str) -> None:
            del key
            raise RuntimeError("缓存挂了")

    anchor = RetentionAnchor(store=cast(loop_module.AnchorStore, BrokenStore()))
    assert await anchor.read() is None
    await anchor.write(NOW)
    await anchor.clear()
