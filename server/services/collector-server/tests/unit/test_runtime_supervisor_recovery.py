"""采集计划失败恢复、变更通知与在途工作的续约。"""

import asyncio
from collections.abc import Callable
from typing import Any
from uuid import uuid4

import pytest

from collector_server.apps.collect.errors import PlanUnavailable
from collector_server.apps.collect.plan.store import PlanStore
from collector_server.apps.collect.runtime.session import (
    SourceSession,
    SourceStatus,
)
from collector_server.apps.collect.runtime.supervisor import (
    CollectSupervisor,
    SupervisorOptions,
)
from collectwire import STATE_CONNECTING, PlanSource
from unit.opcua_driver_fakes import FakeClient, make_driver
from unit.test_runtime_session import _session
from unit.test_runtime_supervisor import (
    FakeFetcher,
    FakeLease,
    FakeSession,
    _hang_stop,
    _supervisor,
    _until,
)


class BlockingFetcher(FakeFetcher):
    """把第二次拉取停在平台应答之前，用事件控制恢复。"""

    def __init__(self, plans: list[Any]) -> None:
        super().__init__(plans)
        self.entered = asyncio.Event()
        self.resume = asyncio.Event()

    async def fetch(self) -> Any:
        plan = await super().fetch()
        if self.calls == 2:
            self.entered.set()
            await self.resume.wait()
        return plan


@pytest.mark.parametrize("is_reverted", [False, True], ids=["same", "rollback"])
async def test_failed_point_update_rebuilds_only_its_source(
    build_plan: Any, build_source: Any, build_point: Any, is_reverted: bool
) -> None:
    old = build_source()
    other = build_source(source_id=uuid4())
    initial = build_plan(sources=(old, other))
    updated = build_source(points=(build_point("new"),))
    changed = build_plan(version="v2", sources=(updated, other))
    final = initial if is_reverted else changed
    plans = [initial, changed, final]
    supervisor, built = _supervisor(FakeLease(), FakeFetcher(plans))
    await supervisor.tick()
    session, unaffected = built

    async def temporarily_unavailable(source: Any) -> None:
        session.applied.append(source)
        raise TimeoutError("后一组订阅请求响应超时")

    session.apply = temporarily_unavailable
    try:
        await supervisor.tick()
        assert session.is_stopped
        assert supervisor.session_of(other.source_id) is unaffected
        assert not unaffected.is_stopped
        await supervisor.tick()
        assert len(built) == 3
        assert supervisor.session_of(old.source_id) is built[-1]
        assert built[-1].source == final.sources[0]
        assert session.applied == [updated]
    finally:
        await supervisor.stop()


async def test_plan_fetch_failure_stops_sampling_until_a_plan_is_available(
    build_plan: Any,
) -> None:
    plan = build_plan()
    supervisor, built = _supervisor(
        FakeLease(), FakeFetcher([plan, PlanUnavailable("平台不可达"), plan])
    )
    source_id = plan.sources[0].source_id
    try:
        await supervisor.tick()
        assert supervisor.is_online(source_id)

        await supervisor.tick()
        assert supervisor.plan.current is None
        assert not supervisor.is_online(source_id)
        assert built[0].is_stopped
        assert built[0].reported_stopped == 1

        await supervisor.tick()
        assert supervisor.is_online(source_id)
        assert len(built) == 2
    finally:
        await supervisor.stop()


async def test_taking_over_validates_the_startup_plan_again(
    build_plan: Any,
) -> None:
    startup_plan = build_plan()
    store = PlanStore(
        fetcher=FakeFetcher([startup_plan, PlanUnavailable("平台不可达")])
    )
    await store.refresh()
    supervisor = CollectSupervisor(
        lease=FakeLease(),
        plan=store,
        builder=FakeSession,
        options=SupervisorOptions(plan_refresh_interval_s=30.0),
        clock=lambda: 0,
    )
    try:
        await supervisor.tick()
        assert supervisor.session_of(startup_plan.sources[0].source_id) is None
    finally:
        await supervisor.stop()


async def test_request_during_fetch_wakes_the_next_refresh(
    build_plan: Any, build_source: Any
) -> None:
    startup = build_plan(sources=())
    source = build_source()
    updated = build_plan(version="v2", sources=(source,))
    fetcher = BlockingFetcher([startup, startup, updated])
    supervisor = CollectSupervisor(
        lease=FakeLease(),
        plan=PlanStore(fetcher=fetcher),
        builder=FakeSession,
        options=SupervisorOptions(plan_refresh_interval_s=30.0),
        clock=lambda: 0,
    )
    await supervisor.start()
    try:
        await _until(lambda: supervisor.plan.current is not None)
        supervisor.request_plan_refresh()
        await asyncio.wait_for(fetcher.entered.wait(), timeout=1)
        supervisor.request_plan_refresh()
        fetcher.resume.set()
        await _until(lambda: supervisor.is_online(source.source_id))
        assert supervisor.plan.current == updated
    finally:
        fetcher.resume.set()
        await supervisor.stop()


async def test_losing_a_lease_during_plan_fetch_stops_sampling(
    build_plan: Any,
) -> None:
    plan = build_plan()
    lease = FakeLease()
    fetcher = BlockingFetcher([plan, plan])
    supervisor, built = _supervisor(lease, fetcher, renew_interval_s=0.01)
    await supervisor.tick()
    ticking = asyncio.create_task(supervisor.tick())
    try:
        await asyncio.wait_for(fetcher.entered.wait(), timeout=1)
        lease.answers = [False]
        await _until(lambda: built[0].is_stopped, timeout_s=0.25)
        assert not supervisor.is_leader
    finally:
        fetcher.resume.set()
        await ticking
        await supervisor.stop()


async def test_shutdown_renews_lease_until_the_connections_are_closed(
    build_plan: Any,
) -> None:
    lease = FakeLease()
    supervisor, built = _supervisor(
        lease, FakeFetcher([build_plan()]), renew_interval_s=0.01
    )
    await supervisor.tick()
    release = asyncio.Event()
    entered = _hang_stop(built[0], release)
    stopping = asyncio.create_task(supervisor.stop())
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        await _until(lambda: lease.renewed >= 1, timeout_s=0.25)
        assert lease.released == 0
    finally:
        release.set()
        await stopping
    assert lease.released == 1


async def test_losing_lease_while_removing_old_connection_does_not_rebuild_it(
    build_plan: Any, build_source: Any
) -> None:
    lease = FakeLease()
    old = build_source()
    replacement = build_source(endpoint="opc.tcp://10.0.0.9:4840/line-1")
    plans = [
        build_plan(sources=(old,)),
        build_plan(version="v2", sources=(replacement,)),
    ]
    supervisor, built = _supervisor(
        lease, FakeFetcher(plans), renew_interval_s=0.01
    )
    await supervisor.tick()
    release = asyncio.Event()
    entered = _hang_stop(built[0], release)
    ticking = asyncio.create_task(supervisor.tick())
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        lease.answers = [False]
        await _until(lambda: not supervisor.is_leader)
    finally:
        release.set()
        await ticking
        await supervisor.stop()
    assert len(built) == 1


async def test_revocation_during_connecting_status_prevents_driver_open(
    build_source: Any, driver: Any
) -> None:
    entered = asyncio.Event()
    release = asyncio.Event()

    class WaitingReporter:
        async def report(self, status: SourceStatus) -> None:
            if status.state == STATE_CONNECTING:
                entered.set()
                await release.wait()

    session = _session(build_source(), driver, WaitingReporter())
    running = asyncio.create_task(session.run())
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        session.revoke()
        release.set()
        await asyncio.wait_for(running, timeout=1)
        assert not driver.has_entered_connect.is_set()
    finally:
        release.set()
        await session.stop()


def _record_native_clients(
    clients: list[FakeClient], reporter: Any
) -> Callable[[PlanSource], SourceSession]:
    """仅在首次连接模拟慢组订阅应答丢失。"""

    def prepare(client: FakeClient) -> None:
        clients.append(client)
        if len(clients) > 1:
            return
        subscribe = client.subscription.subscribe_data_change

        async def fail_one_group(*args: Any, **options: Any) -> Any:
            if options["sampling_interval"] == 2000:
                raise TimeoutError("慢组的 OPC UA 应答丢失")
            return await subscribe(*args, **options)

        client.subscription.subscribe_data_change = fail_one_group

    def create(source: PlanSource) -> SourceSession:
        driver, _ = make_driver(prepare=prepare)
        return _session(source, driver, reporter)

    return create


async def test_native_partial_subscription_is_replaced_once(
    build_plan: Any, build_source: Any, build_point: Any, reporter: Any
) -> None:
    initial = build_source()
    updated = initial.model_copy(
        update={
            "points": (
                *initial.points,
                build_point("fast"),
                build_point("slow", sampling_interval_ms=2000),
            )
        }
    )
    clients: list[FakeClient] = []
    supervisor = CollectSupervisor(
        lease=FakeLease(),
        plan=PlanStore(
            fetcher=FakeFetcher(
                [
                    build_plan(sources=(initial,)),
                    build_plan(version="v2", sources=(updated,)),
                ]
            )
        ),
        builder=_record_native_clients(clients, reporter),
        options=SupervisorOptions(plan_refresh_interval_s=0),
    )
    try:
        await supervisor.tick()
        await _until(lambda: reporter.states() == ["connecting", "online"])
        await supervisor.tick()
        assert clients[0].subscription.handles == [1, 2]
        assert clients[0].is_disconnect_requested
        await supervisor.tick()
        await _until(lambda: reporter.states()[-1] == "online")
        assert len(clients) == 2
        assert clients[1].subscription.handles == [1, 2, 3]
        assert clients[1].subscription.batches == [(2, 1000), (1, 2000)]
    finally:
        await supervisor.stop()
