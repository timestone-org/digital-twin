"""守单活与收敛：非 leader 不建会话、丢主立刻停手、计划变了才动会话。

⚠ 两个副本同时采同一台设备会击穿现场的会话上限，是本服务的头号故障，
所以「Redis 说不行就当自己不是主」这条必须锁死（runtime-resilience §6.2）。
"""

import asyncio
from typing import Any
from uuid import uuid4

import pytest

from collector_server.apps.collect.errors import PlanUnavailable
from collector_server.apps.collect.plan.store import PlanStore
from collector_server.apps.collect.runtime import (
    supervisor as supervisor_module,
)
from collector_server.apps.collect.runtime.supervisor import (
    LEASE_KEY,
    LEASE_RENEW_INTERVAL_S,
    LEASE_TTL_S,
    CollectSupervisor,
    SupervisorOptions,
)


class FakeLease:
    """按脚本回答的租约。"""

    def __init__(self, *, answers: list[bool] | None = None) -> None:
        self.answers = answers or []
        self.acquired = 0
        self.renewed = 0
        self.released = 0

    def _next(self, *, is_granted_by_default: bool) -> bool:
        return self.answers.pop(0) if self.answers else is_granted_by_default

    async def acquire(self) -> bool:
        self.acquired += 1
        return self._next(is_granted_by_default=True)

    async def renew(self) -> bool:
        self.renewed += 1
        return self._next(is_granted_by_default=True)

    async def release(self) -> None:
        self.released += 1

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        return None


class FakeFetcher:
    """按脚本给计划的取数面。"""

    def __init__(self, plans: list[Any]) -> None:
        self.plans = plans
        self.calls = 0

    async def fetch(self) -> Any:
        self.calls += 1
        return self.plans[min(self.calls - 1, len(self.plans) - 1)]


class FakeSession:
    """记录起停的会话替身。"""

    def __init__(self, source: Any) -> None:
        self.source = source
        self.source_id = source.source_id
        self.applied: list[Any] = []
        self.is_online = True
        self.is_subscribing = True
        self.is_stopped = False
        self.reported_stopped = 0
        self.driver = object()
        self._forever = asyncio.Event()

    async def run(self) -> None:
        await self._forever.wait()

    async def stop(self) -> None:
        self.is_stopped = True
        self._forever.set()

    def revoke(self) -> None:
        self.is_online = False
        self.is_stopped = True

    async def report_stopped(self) -> None:
        self.reported_stopped += 1

    async def apply(self, source: Any) -> None:
        self.applied.append(source)


class UnavailablePlan:
    """永远拉不到计划的取数面。"""

    async def fetch(self) -> Any:
        raise PlanUnavailable("拉不到采集计划")


class ExplodingPlan:
    """抛出计划层没约定过的异常，用来验主循环不会被一拍带走。"""

    async def fetch(self) -> Any:
        raise RuntimeError("谁也没想到")


async def _until(is_done: Any, *, timeout_s: float = 3.0) -> None:
    """等一个条件成立；等不到就让用例失败而不是挂住。

    Args: is_done, timeout_s。
    """
    async with asyncio.timeout(timeout_s):
        # 抑制的理由 —— 等的是同一个事件循环上别的任务推进，不是外部信号；
        # 换成 Event 就要求被测对象为测试多出一个通知点
        while not is_done():  # noqa: ASYNC110
            await asyncio.sleep(0)


def _supervisor(
    lease: FakeLease,
    fetcher: FakeFetcher,
    *,
    renew_interval_s: float = LEASE_RENEW_INTERVAL_S,
) -> tuple[CollectSupervisor, list[FakeSession]]:
    built: list[FakeSession] = []

    def builder(source: Any) -> FakeSession:
        session = FakeSession(source)
        built.append(session)
        return session

    supervisor = CollectSupervisor(
        lease=lease,
        plan=PlanStore(fetcher=fetcher),
        builder=builder,
        options=SupervisorOptions(
            plan_refresh_interval_s=0.0, lease_renew_interval_s=renew_interval_s
        ),
        clock=lambda: 0,
    )
    return supervisor, built


def test_lease_key_and_ttl_match_the_design() -> None:
    assert (LEASE_KEY, LEASE_TTL_S) == ("collect:leader", 15)


def test_renew_interval_is_well_inside_the_lease() -> None:
    assert LEASE_RENEW_INTERVAL_S * 2 < LEASE_TTL_S


async def test_a_replica_that_cannot_take_the_lease_builds_nothing(
    build_plan: Any,
) -> None:
    lease = FakeLease(answers=[False])
    supervisor, built = _supervisor(lease, FakeFetcher([build_plan()]))
    await supervisor.tick()
    assert built == []
    assert supervisor.is_leader is False


async def test_taking_the_lease_converges_the_whole_plan(
    build_plan: Any,
) -> None:
    supervisor, built = _supervisor(FakeLease(), FakeFetcher([build_plan()]))
    await supervisor.tick()
    assert [session.source_id for session in built] == [
        source.source_id for source in build_plan().sources
    ]
    await supervisor.stop()


async def test_one_invalid_source_does_not_block_other_sessions(
    build_plan: Any, build_source: Any
) -> None:
    invalid = build_source(uuid4())
    healthy = build_source(uuid4())
    built: list[FakeSession] = []

    def builder(source: Any) -> FakeSession:
        if source.source_id == invalid.source_id:
            raise ValueError("invalid source")
        session = FakeSession(source)
        built.append(session)
        return session

    supervisor = CollectSupervisor(
        lease=FakeLease(),
        plan=PlanStore(
            fetcher=FakeFetcher([build_plan(sources=(invalid, healthy))])
        ),
        builder=builder,
        options=SupervisorOptions(plan_refresh_interval_s=0.0),
        clock=lambda: 0,
    )
    await supervisor.tick()
    assert [session.source_id for session in built] == [healthy.source_id]
    await supervisor.stop()


async def test_losing_the_lease_stops_every_session(build_plan: Any) -> None:
    lease = FakeLease(answers=[True, False])
    supervisor, built = _supervisor(lease, FakeFetcher([build_plan()]))
    await supervisor.tick()
    await supervisor.tick()
    assert built[0].is_stopped is True
    assert supervisor.is_leader is False


async def test_lease_loss_revokes_all_sources_before_slow_teardown(
    build_plan: Any, build_source: Any
) -> None:
    first = build_source(uuid4())
    second = build_source(uuid4())
    lease = FakeLease(answers=[True, False])
    plan = build_plan(sources=(first, second))
    supervisor, built = _supervisor(lease, FakeFetcher([plan]))
    await supervisor.tick()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def slow_stop() -> None:
        entered.set()
        await release.wait()

    built[0].stop = slow_stop
    dropping = asyncio.create_task(supervisor.tick())
    await asyncio.wait_for(entered.wait(), timeout=1)
    assert built[1].is_stopped is True
    assert built[1].is_online is False
    release.set()
    await asyncio.wait_for(dropping, timeout=1)


async def test_subscribing_is_answered_by_the_live_session(
    build_plan: Any,
) -> None:
    supervisor, built = _supervisor(FakeLease(), FakeFetcher([build_plan()]))
    source_id = build_plan().sources[0].source_id
    assert supervisor.is_subscribing(source_id) is False
    await supervisor.tick()
    assert supervisor.is_subscribing(source_id) is True
    built[0].is_subscribing = False
    assert supervisor.is_subscribing(source_id) is False
    assert supervisor.is_subscribing(uuid4()) is False
    await supervisor.stop()


async def test_a_dropped_session_is_no_longer_subscribing(
    build_plan: Any,
) -> None:
    # 丢主拆掉会话之后再补心跳，就是一个非 leader 在造行
    lease = FakeLease(answers=[True, False])
    supervisor, _ = _supervisor(lease, FakeFetcher([build_plan()]))
    source_id = build_plan().sources[0].source_id
    await supervisor.tick()
    await supervisor.tick()
    assert supervisor.is_subscribing(source_id) is False
    assert supervisor.is_online(source_id) is False


async def test_online_is_answered_by_the_live_session(build_plan: Any) -> None:
    supervisor, built = _supervisor(FakeLease(), FakeFetcher([build_plan()]))
    source_id = build_plan().sources[0].source_id
    await supervisor.tick()
    assert supervisor.is_online(source_id) is True
    built[0].is_online = False
    assert supervisor.is_online(source_id) is False
    await supervisor.stop()


async def test_an_unchanged_plan_version_leaves_sessions_alone(
    build_plan: Any,
) -> None:
    supervisor, built = _supervisor(
        FakeLease(), FakeFetcher([build_plan(), build_plan()])
    )
    await supervisor.tick()
    await supervisor.tick()
    assert len(built) == 1
    assert built[0].applied == []
    await supervisor.stop()


async def test_a_removed_source_loses_its_session(
    build_plan: Any, build_source: Any
) -> None:
    supervisor, built = _supervisor(
        FakeLease(),
        FakeFetcher(
            [
                build_plan(),
                build_plan(version="v2", sources=(build_source(uuid4()),)),
            ]
        ),
    )
    await supervisor.tick()
    await supervisor.tick()
    assert built[0].is_stopped is True
    assert len(built) == 2
    await supervisor.stop()


async def test_changing_only_the_points_keeps_the_connection(
    build_plan: Any, build_source: Any, build_point: Any
) -> None:
    grown = build_source(points=(build_point("a"), build_point("b")))
    supervisor, built = _supervisor(
        FakeLease(),
        FakeFetcher([build_plan(), build_plan(version="v2", sources=(grown,))]),
    )
    await supervisor.tick()
    await supervisor.tick()
    assert len(built) == 1
    assert built[0].applied == [grown]
    await supervisor.stop()


async def test_changing_the_endpoint_rebuilds_the_session(
    build_plan: Any, build_source: Any
) -> None:
    moved = build_source(endpoint="opc.tcp://10.0.0.9:4840/line-1")
    supervisor, built = _supervisor(
        FakeLease(),
        FakeFetcher([build_plan(), build_plan(version="v2", sources=(moved,))]),
    )
    await supervisor.tick()
    await supervisor.tick()
    assert built[0].is_stopped is True
    assert len(built) == 2
    await supervisor.stop()


async def test_without_a_plan_nothing_is_built(build_plan: Any) -> None:
    supervisor, built = _supervisor(FakeLease(), FakeFetcher([build_plan()]))
    supervisor._plan = PlanStore(fetcher=UnavailablePlan())
    await supervisor.tick()
    assert built == []


async def test_one_bad_tick_does_not_take_the_main_loop_down(
    build_plan: Any,
) -> None:
    lease = FakeLease()
    supervisor, built = _supervisor(lease, FakeFetcher([build_plan()]))
    supervisor._plan = PlanStore(fetcher=ExplodingPlan())
    await supervisor.start()
    await _until(lambda: lease.acquired >= 1)
    await supervisor.stop()
    assert built == []
    assert lease.acquired >= 1


async def test_shutdown_lets_the_lease_go_after_the_sessions(
    build_plan: Any,
) -> None:
    lease = FakeLease()
    supervisor, built = _supervisor(lease, FakeFetcher([build_plan()]))
    await supervisor.start()
    await _until(lambda: bool(built))
    await supervisor.stop()
    assert built[0].is_stopped is True
    assert lease.released == 1


async def test_a_replica_that_never_led_does_not_release_a_lease() -> None:
    lease = FakeLease(answers=[False])
    supervisor, _ = _supervisor(lease, FakeFetcher([]))
    await supervisor.tick()
    await supervisor.stop()
    assert lease.released == 0


def _hang_stop(session: FakeSession, release: asyncio.Event) -> asyncio.Event:
    """让一条会话拆得很慢：stop 一直卡到 release 被置位。

    Args: session, release。
    """
    entered = asyncio.Event()

    async def slow_stop() -> None:
        entered.set()
        await release.wait()
        session.is_stopped = True
        session._forever.set()

    session.stop = slow_stop
    return entered


async def test_a_slow_converge_keeps_renewing_the_lease(
    build_plan: Any, build_source: Any
) -> None:
    # 一条拆得很慢的会话不许把续约饿死：饿过 TTL，热备就会在我们还握着
    # 现场会话时接手
    lease = FakeLease()
    plans = [
        build_plan(),
        build_plan(version="v2", sources=(build_source(uuid4()),)),
    ]
    supervisor, built = _supervisor(
        lease, FakeFetcher(plans), renew_interval_s=0.01
    )
    await supervisor.tick()
    release = asyncio.Event()
    entered = _hang_stop(built[0], release)
    ticking = asyncio.create_task(supervisor.tick())
    await asyncio.wait_for(entered.wait(), timeout=1)
    renewed_before = lease.renewed
    await _until(lambda: lease.renewed >= renewed_before + 3)
    release.set()
    await asyncio.wait_for(ticking, timeout=1)
    assert supervisor.is_leader is True
    assert len(built) == 2
    await supervisor.stop()


async def test_losing_the_lease_mid_converge_stops_and_builds_nothing_more(
    build_plan: Any, build_source: Any
) -> None:
    lease = FakeLease()
    first = build_source(uuid4())
    second = build_source(uuid4())
    plans = [
        build_plan(sources=(first,)),
        build_plan(version="v2", sources=(second,)),
    ]
    supervisor, built = _supervisor(
        lease, FakeFetcher(plans), renew_interval_s=0.01
    )
    await supervisor.tick()
    release = asyncio.Event()
    entered = _hang_stop(built[0], release)
    ticking = asyncio.create_task(supervisor.tick())
    await asyncio.wait_for(entered.wait(), timeout=1)
    lease.answers = [False]
    await _until(lambda: supervisor.is_leader is False)
    release.set()
    await asyncio.wait_for(ticking, timeout=1)
    assert len(built) == 1
    assert supervisor.is_online(second.source_id) is False
    assert built[0].reported_stopped == 0


async def test_a_removed_source_is_reported_offline(
    build_plan: Any, build_source: Any
) -> None:
    supervisor, built = _supervisor(
        FakeLease(),
        FakeFetcher(
            [
                build_plan(),
                build_plan(version="v2", sources=(build_source(uuid4()),)),
            ]
        ),
    )
    await supervisor.tick()
    await supervisor.tick()
    assert built[0].reported_stopped == 1
    await supervisor.stop()


async def test_shutdown_reports_every_session_offline(build_plan: Any) -> None:
    supervisor, built = _supervisor(FakeLease(), FakeFetcher([build_plan()]))
    await supervisor.tick()
    await supervisor.stop()
    assert built[0].reported_stopped == 1


async def test_losing_the_lease_leaves_the_state_row_to_the_new_leader(
    build_plan: Any,
) -> None:
    lease = FakeLease(answers=[True, False])
    supervisor, built = _supervisor(lease, FakeFetcher([build_plan()]))
    await supervisor.tick()
    await supervisor.tick()
    assert built[0].is_stopped is True
    assert built[0].reported_stopped == 0


async def test_a_session_that_will_not_stop_is_cancelled_after_the_grace(
    build_plan: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 拆不掉的会话不许把关停挂死：等满宽限就取消，照样让出租约
    monkeypatch.setattr(supervisor_module, "DROP_GRACE_S", 0.05)
    lease = FakeLease()
    supervisor, built = _supervisor(lease, FakeFetcher([build_plan()]))
    await supervisor.tick()
    _hang_stop(built[0], asyncio.Event())
    async with asyncio.timeout(1):
        await supervisor.stop()
    assert lease.released == 1


async def test_the_plan_can_shorten_its_own_refresh_interval(
    build_plan: Any,
) -> None:
    now = {"ms": 1_000_000}
    plan = build_plan(params={"collect": {"plan_refresh_interval_s": 5}})
    supervisor = CollectSupervisor(
        lease=FakeLease(),
        plan=PlanStore(fetcher=FakeFetcher([plan])),
        builder=FakeSession,
        options=SupervisorOptions(plan_refresh_interval_s=30.0),
        clock=lambda: now["ms"],
    )
    await supervisor.tick()
    now["ms"] += 6_000
    assert supervisor._is_plan_due() is True
    await supervisor.stop()


async def test_losing_the_lease_mid_converge_revokes_the_live_sessions(
    build_plan: Any, build_source: Any
) -> None:
    # 拆着一条慢会话时丢了主：其余活着的会话要当场撤销，不等收敛走完
    lease = FakeLease()
    first, second, third = (build_source(uuid4()) for _ in range(3))
    plans = [
        build_plan(sources=(first, second, third)),
        build_plan(version="v2", sources=(third,)),
    ]
    supervisor, built = _supervisor(
        lease, FakeFetcher(plans), renew_interval_s=0.01
    )
    await supervisor.tick()
    release = asyncio.Event()
    entered = _hang_stop(built[0], release)
    ticking = asyncio.create_task(supervisor.tick())
    await asyncio.wait_for(entered.wait(), timeout=1)
    lease.answers = [False]
    await _until(lambda: built[2].is_online is False)
    release.set()
    await asyncio.wait_for(ticking, timeout=1)
    assert built[1].reported_stopped == 0
    assert supervisor.is_online(third.source_id) is False


async def test_a_failed_offline_report_does_not_stop_the_teardown(
    build_plan: Any,
) -> None:
    supervisor, built = _supervisor(FakeLease(), FakeFetcher([build_plan()]))
    await supervisor.tick()

    async def refuse() -> None:
        raise ConnectionError("库暂时连不上")

    built[0].report_stopped = refuse
    await supervisor.stop()
    assert built[0].is_stopped is True
