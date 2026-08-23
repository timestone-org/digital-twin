"""采集循环的单活、开关与逐表隔离。

⚠ 这一组守的是三件「没人会报错」的事：非 leader 的那一拍不许碰库（碰了下一步
就是两个副本往同一批桶各写各的）；开关要在**拍内**读（启动时读一次的话，运维
关掉之后还要重启才停得下来）；一张表出错不许带走同一拍里其余的表。
"""

import asyncio
import contextlib
import uuid
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import collector as loop_module
from platform_server.apps.dataset.services.collect_run import (
    RunLimits,
    RunOutcome,
)
from platform_server.apps.dataset.services.collector import (
    CollectorContext,
    DatasetCollector,
    knobs_of,
)
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from platform_server.lease import Lease
from platform_server.settings import Settings
from unit.dataset_fakes import FakeHistory, FakeSetSink
from unit.publish_fakes import FakeLease
from unit.wiring_fakes import build_settings

FIRST_TABLE = uuid.UUID("0192f0c0-0000-7000-8000-0000000000a1")
SECOND_TABLE = uuid.UUID("0192f0c0-0000-7000-8000-0000000000a2")


@dataclass
class SpySessions:
    """记下开过几次会话；本组用例不碰真库。

    ⚠ 计数就是断言本身：非 leader 的那一拍必须**一次都不开**——开了就说明我们
    在没有租约的时候读了库，而下一步就是往台账里写行。
    """

    opened: int = 0

    @contextlib.asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        self.opened += 1
        yield cast(AsyncSession, None)


@dataclass
class SpyRuns:
    """替掉逐表采集，记下问过哪几张表、并按需在某张表上抛。"""

    seen: list[uuid.UUID] = field(default_factory=list[uuid.UUID])
    failures: set[uuid.UUID] = field(default_factory=set[uuid.UUID])
    #: 第一张表被问到时置位，用例据它等到「循环真的转起来了」
    touched: asyncio.Event = field(default_factory=asyncio.Event)

    async def collect_table(
        self,
        _session: object,
        _context: object,
        *,
        table_id: uuid.UUID,
        now: datetime,
        limits: RunLimits,
    ) -> RunOutcome:
        del now
        self.seen.append(table_id)
        self.touched.set()
        if table_id in self.failures:
            raise RuntimeError("这张表算不动")
        return RunOutcome(
            table_code=str(table_id),
            buckets=limits.max_buckets_per_tick,
            written=1,
            watermark=None,
            is_awaiting_columns=False,
        )


def make_context(sessions: SpySessions, settings: Settings) -> CollectorContext:
    """一份不连任何网络的循环协作者。

    Args: sessions, settings。
    """
    return CollectorContext(
        database=sessions,
        history=FakeHistory(),
        dirty=DatasetDirtyLog(sink=FakeSetSink()),
        settings=settings,
    )


@pytest.fixture
def wired(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease]:
    """一条装好假件的循环：租约、会话、逐表采集全部替掉。

    Args: monkeypatch。
    """
    sessions = SpySessions()
    runs = SpyRuns()
    lease = FakeLease()
    settings = build_settings()
    monkeypatch.setattr(loop_module, "collect_table", runs.collect_table)
    _stub_tables(monkeypatch, [FIRST_TABLE, SECOND_TABLE])
    _stub_knobs(monkeypatch, {"dataset_enabled": True})
    collector = DatasetCollector(
        context=make_context(sessions, settings), lease=cast(Lease, lease)
    )
    return collector, sessions, runs, lease


def _stub_tables(
    monkeypatch: pytest.MonkeyPatch, table_ids: list[uuid.UUID]
) -> None:
    """把「有哪几张按周期聚合的台账」换成一份名单。

    Args: monkeypatch, table_ids。
    """

    async def aggregating_ids(_session: object) -> list[uuid.UUID]:
        return list(table_ids)

    monkeypatch.setattr(
        loop_module.table_crud, "aggregating_ids", aggregating_ids
    )


def _stub_knobs(
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


async def test_a_tick_without_the_lease_never_opens_a_session(
    wired: tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease],
) -> None:
    collector, sessions, runs, lease = wired
    lease.is_grantable = False
    await collector.tick()
    assert collector.is_leader is False
    assert sessions.opened == 0
    assert runs.seen == []


async def test_losing_the_lease_stops_the_very_next_tick(
    wired: tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease],
) -> None:
    # ⚠ renew-or-die：续不上还继续算，就是两个副本往同一批桶各写各的
    collector, _sessions, runs, lease = wired
    await collector.tick()
    assert collector.is_leader is True
    lease.is_renewable = False
    await collector.tick()
    assert collector.is_leader is False
    assert runs.seen == [FIRST_TABLE, SECOND_TABLE]


async def test_the_switch_is_read_inside_the_tick(
    wired: tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # ⚠ 在拍内读而不是启动时读一次：运维在界面上一关，下一拍就停，不必重启
    collector, _sessions, runs, _lease = wired
    await collector.tick()
    assert runs.seen == [FIRST_TABLE, SECOND_TABLE]
    _stub_knobs(monkeypatch, {"dataset_enabled": False})
    await collector.tick()
    assert runs.seen == [FIRST_TABLE, SECOND_TABLE]
    _stub_knobs(monkeypatch, {"dataset_enabled": True})
    await collector.tick()
    assert runs.seen[-2:] == [FIRST_TABLE, SECOND_TABLE]


async def test_the_switch_off_still_holds_the_lease(
    wired: tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 关掉的是「采不采」，不是「谁是主」：让位会让另一个副本立刻接过来空转
    collector, _sessions, _runs, _lease = wired
    _stub_knobs(monkeypatch, {"dataset_enabled": False})
    await collector.tick()
    assert collector.is_leader is True


async def test_a_table_that_blows_up_does_not_take_the_others_with_it(
    wired: tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease],
) -> None:
    collector, _sessions, runs, _lease = wired
    runs.failures.add(FIRST_TABLE)
    await collector.tick()
    assert runs.seen == [FIRST_TABLE, SECOND_TABLE]


async def test_each_table_gets_its_own_session(
    wired: tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease],
) -> None:
    # ⚠ 整拍共用一个事务的话，一张表撞上约束会把已经算好的其余表一起回滚
    collector, sessions, _runs, _lease = wired
    await collector.tick()
    # 一次读开关 + 一次取名单 + 两张表各一个
    assert sessions.opened == 4


async def test_stopping_mid_tick_skips_the_remaining_tables(
    wired: tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 关停第一步是「停收新活」：手上这张算完，后面的不再开始
    collector, _sessions, runs, _lease = wired
    original = runs.collect_table

    async def stop_after_first(*args: object, **kwargs: object) -> RunOutcome:
        collector.stop()
        return await original(
            *args, **kwargs
        )  # pyright: ignore[reportArgumentType, reportCallIssue]

    monkeypatch.setattr(loop_module, "collect_table", stop_after_first)
    await collector.tick()
    assert runs.seen == [FIRST_TABLE]


async def test_the_lease_is_only_handed_back_when_it_is_held(
    wired: tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease],
) -> None:
    collector, _sessions, _runs, lease = wired
    await collector.release()
    assert "release" not in lease.ledger
    await collector.tick()
    await collector.release()
    assert lease.ledger.count("release") == 1
    assert collector.is_leader is False


async def test_draining_returns_at_once_when_no_tick_is_in_flight(
    wired: tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease],
) -> None:
    # ⚠ 没有在途的一拍时 drain 必须立刻回：等满预算会把关停拖成那么久，而编排
    # 器的宽限期是有限的——超过就是 SIGKILL，在途的事务连回滚都来不及
    collector, _sessions, _runs, _lease = wired
    loop = asyncio.get_running_loop()
    started = loop.time()
    await collector.drain(30.0)
    assert loop.time() - started < 1.0


async def test_the_loop_exits_after_it_is_told_to_stop(
    wired: tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease],
) -> None:
    # 关停第一步是停收新活；`run` 在下一次醒来时就该退出，而不是等满一整拍
    collector, _sessions, runs, _lease = wired
    task = asyncio.create_task(collector.run())
    try:
        await asyncio.wait_for(runs.touched.wait(), timeout=2.0)
    finally:
        collector.stop()
    await asyncio.wait_for(task, timeout=2.0)
    # ⚠ 关键是它**退出了**而不是等满一整拍的间隔：`_pause` 要被叫停唤醒，
    # 而不是傻等 60 秒——那会把关停拖过编排器的宽限期
    assert task.done()
    assert runs.seen[0] == FIRST_TABLE


@pytest.mark.parametrize("given", ["很快", True, None])
def test_a_knob_of_the_wrong_shape_falls_back_to_the_environment(
    given: object,
) -> None:
    """形状不对时回落到环境变量而不是拿一个 0 去跑。

    ⚠ 0 的间隔是空转打满一个核；而 `True` 尤其要挡——bool 是 int 的子类，
    不挡就会有一个 `true` 悄悄变成 1 秒一拍。
    Args: given。
    """
    settings = build_settings()
    knobs = knobs_of({"dataset_interval_s": given}, settings)
    assert knobs.interval_s == settings.dataset_interval_s


def test_the_knobs_prefer_the_override_over_the_environment() -> None:
    settings = build_settings()
    knobs = knobs_of(
        {"dataset_enabled": True, "dataset_max_buckets_per_tick": 7}, settings
    )
    assert knobs.is_enabled is True
    assert knobs.limits.max_buckets_per_tick == 7


async def test_a_failing_tick_does_not_take_the_loop_down(
    wired: tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """一拍出错只该丢掉那一拍。

    ⚠ 带走整个循环的话，它就再也不续租约、也不再采集，而进程还活着、探针还
    绿着——这是最难察觉的一种停摆。
    """
    collector, _sessions, runs, _lease = wired
    _stub_knobs(
        monkeypatch, {"dataset_enabled": True, "dataset_interval_s": 0.01}
    )
    asked: list[int] = []

    async def flaky(_session: object) -> list[uuid.UUID]:
        asked.append(1)
        if len(asked) == 1:
            raise RuntimeError("库抖了一下")
        return [FIRST_TABLE]

    monkeypatch.setattr(loop_module.table_crud, "aggregating_ids", flaky)
    task = asyncio.create_task(collector.run())
    try:
        await asyncio.wait_for(runs.touched.wait(), timeout=5.0)
    finally:
        collector.stop()
    await asyncio.wait_for(task, timeout=5.0)
    assert len(asked) >= 2
    assert runs.seen == [FIRST_TABLE]


async def test_a_quiet_tick_writes_no_summary_line(
    wired: tuple[DatasetCollector, SpySessions, SpyRuns, FakeLease],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # ⚠ 一分钟一条的流水会把真正有内容的那几条埋掉，故无事发生的一拍不记
    del wired
    lines: list[str] = []
    monkeypatch.setattr(
        loop_module._logger,  # pyright: ignore[reportPrivateUsage]
        "info",
        lambda event, *_args, **_kwargs: lines.append(event),
    )
    loop_module._log_tick(  # pyright: ignore[reportPrivateUsage]
        [
            RunOutcome(
                table_code="quiet",
                buckets=1,
                written=0,
                watermark=None,
                is_awaiting_columns=False,
            )
        ]
    )
    assert lines == []
