"""发布循环的单活口径：不持租约就不推，续不上立刻停手并丢缓存。

⚠ renew-or-die 少一步都不行：续不上还继续推，就是两个副本对同一个主题各推
各的，客户端在同一段 seq 里收到两份不同的值。
⚠ 两条链路（大屏 / 采集配置页）必须互不牵连：一条炸了另一条照跑，否则配置页
的一次读库失败会顺带让全厂大屏这一拍不更新。
"""

import asyncio
from dataclasses import dataclass, field

from platform_server.publisher import Lane, LoopOptions, PublisherRuntime
from unit.publish_fakes import FakeLease

WINDOW_S = 0.01
RECONCILE_INTERVAL_S = 30.0


@dataclass
class SpyLane:
    """记下被调了几拍、被清了几次缓存，并在跑够拍数时给一个完成信号。

    ⚠ 用信号而不是轮询等：轮询在慢机器上要么假红要么白等满超时。
    """

    name: str = "dashboard"
    ticks: int = 0
    forgotten: int = 0
    failure: Exception | None = None
    target_ticks: int = 1
    rounds: list[tuple[int, int]] = field(default_factory=list[tuple[int, int]])
    reached: asyncio.Event = field(default_factory=asyncio.Event)

    async def publish(self) -> None:
        self.ticks += 1
        if self.ticks >= self.target_ticks:
            self.reached.set()
        if self.failure is not None:
            raise self.failure

    async def reconcile(self) -> tuple[int, int]:
        result = (0, 0)
        self.rounds.append(result)
        return result

    def forget_all(self) -> None:
        self.forgotten += 1

    def as_lane(self) -> Lane:
        return Lane(
            name=self.name,
            reconcile=self.reconcile,
            tick=self.publish,
            forget_all=self.forget_all,
        )


@dataclass
class Harness:
    """一套装好的循环与它的假件。"""

    runtime: PublisherRuntime
    lease: FakeLease
    publisher: SpyLane
    reconciler: SpyLane
    collect: SpyLane


def build_harness(
    *,
    is_grantable: bool = True,
    is_renewable: bool = True,
    reconcile_interval_s: float = RECONCILE_INTERVAL_S,
) -> Harness:
    """装一套循环，两条链路各一件假件。

    Args: is_grantable, is_renewable, reconcile_interval_s。
    """
    lease = FakeLease(is_grantable=is_grantable, is_renewable=is_renewable)
    dashboards = SpyLane(name="dashboard")
    collect = SpyLane(name="collect")
    runtime = PublisherRuntime(
        lease=lease,
        lanes=(dashboards.as_lane(), collect.as_lane()),
        options=LoopOptions(
            window_s=WINDOW_S, reconcile_interval_s=reconcile_interval_s
        ),
    )
    return Harness(
        runtime=runtime,
        lease=lease,
        publisher=dashboards,
        reconciler=dashboards,
        collect=collect,
    )


async def test_a_replica_without_the_lease_publishes_nothing() -> None:
    harness = build_harness(is_grantable=False)
    await harness.runtime.tick()
    assert harness.publisher.ticks == 0
    assert harness.runtime.is_leader is False


async def test_the_replica_that_takes_the_lease_publishes() -> None:
    harness = build_harness()
    await harness.runtime.tick()
    assert harness.publisher.ticks == 1
    assert harness.runtime.is_leader is True


async def test_a_held_lease_is_renewed_on_the_next_tick() -> None:
    harness = build_harness()
    await harness.runtime.tick()
    await harness.runtime.tick()
    assert harness.lease.ledger == ["acquire", "renew"]


async def test_losing_the_renewal_stops_publishing_at_once() -> None:
    harness = build_harness(is_renewable=False)
    await harness.runtime.tick()
    await harness.runtime.tick()
    assert harness.publisher.ticks == 1
    assert harness.runtime.is_leader is False


async def test_losing_the_lease_drops_the_process_cache() -> None:
    # 接任者会从全量帧重新开始，我们手上那份「已经推过什么」对它没有意义
    harness = build_harness(is_renewable=False)
    await harness.runtime.tick()
    await harness.runtime.tick()
    assert harness.publisher.forgotten == 1


async def test_the_topics_are_reconciled_on_the_first_tick() -> None:
    harness = build_harness()
    await harness.runtime.tick()
    assert harness.reconciler.rounds == [(0, 0)]


async def test_the_reconcile_does_not_run_every_tick() -> None:
    harness = build_harness()
    await harness.runtime.tick()
    await harness.runtime.tick()
    assert len(harness.reconciler.rounds) == 1


async def test_a_short_interval_lets_the_reconcile_run_again() -> None:
    harness = build_harness(reconcile_interval_s=0.0)
    await harness.runtime.tick()
    await harness.runtime.tick()
    assert len(harness.reconciler.rounds) == 2


async def test_a_failed_tick_does_not_kill_the_loop() -> None:
    harness = build_harness()
    harness.publisher.failure = RuntimeError("这一拍炸了")
    harness.publisher.target_ticks = 2
    task = asyncio.create_task(harness.runtime.run())
    await asyncio.wait_for(harness.publisher.reached.wait(), timeout=2.0)
    harness.runtime.stop()
    await task
    assert harness.publisher.ticks >= 2


async def test_both_lanes_publish_on_the_same_tick() -> None:
    harness = build_harness()
    await harness.runtime.tick()
    assert (harness.publisher.ticks, harness.collect.ticks) == (1, 1)


async def test_a_broken_lane_does_not_stop_the_other_one() -> None:
    # 配置页那条链路读库失败，不许顺带让全厂大屏这一拍不更新
    harness = build_harness()
    harness.publisher.failure = RuntimeError("大屏这条炸了")
    await harness.runtime.tick()
    assert harness.collect.ticks == 1


async def test_losing_the_lease_drops_every_lane_cache() -> None:
    harness = build_harness(is_renewable=False)
    await harness.runtime.tick()
    await harness.runtime.tick()
    assert (harness.publisher.forgotten, harness.collect.forgotten) == (1, 1)


async def test_stopping_the_loop_lets_it_finish_the_tick_in_hand() -> None:
    harness = build_harness()
    task = asyncio.create_task(harness.runtime.run())
    await asyncio.wait_for(harness.publisher.reached.wait(), timeout=2.0)
    harness.runtime.stop()
    await harness.runtime.drain(timeout_s=1.0)
    await task
    assert harness.publisher.ticks >= 1


async def test_a_replica_that_never_led_gives_up_no_lease() -> None:
    harness = build_harness(is_grantable=False)
    await harness.runtime.tick()
    await harness.runtime.release()
    assert "release" not in harness.lease.ledger


async def test_standing_down_hands_the_lease_back_immediately() -> None:
    # 让位比等它自然过期快一个 TTL，热备因此不必等满 TTL 才接管
    harness = build_harness()
    await harness.runtime.tick()
    await harness.runtime.release()
    assert harness.lease.ledger == ["acquire", "release"]
    assert harness.runtime.is_leader is False


async def test_draining_returns_when_the_loop_is_already_idle() -> None:
    harness = build_harness()
    await harness.runtime.drain(timeout_s=0.05)
    assert harness.publisher.ticks == 0
