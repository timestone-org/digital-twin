"""发布循环的单活口径：不持租约就不推，续不上立刻停手并丢缓存。

⚠ renew-or-die 少一步都不行：续不上还继续推，就是两个副本对同一个主题各推
各的，客户端在同一段 seq 里收到两份不同的值。
"""

import asyncio
from dataclasses import dataclass, field

from platform_server.apps.dashboard.services.publish_service import (
    PublishReport,
)
from platform_server.publisher import LoopOptions, PublisherRuntime
from unit.publish_fakes import FakeLease

WINDOW_S = 0.01
RECONCILE_INTERVAL_S = 30.0


@dataclass
class SpyPublisher:
    """记下被调了几拍、被清了几次缓存，并在跑够拍数时给一个完成信号。

    ⚠ 用信号而不是轮询等：轮询在慢机器上要么假红要么白等满超时。
    """

    ticks: int = 0
    forgotten: int = 0
    failure: Exception | None = None
    target_ticks: int = 1
    reached: asyncio.Event = field(default_factory=asyncio.Event)

    async def publish_once(self) -> PublishReport:
        self.ticks += 1
        if self.ticks >= self.target_ticks:
            self.reached.set()
        if self.failure is not None:
            raise self.failure
        return PublishReport(dashboards=1, items=2)

    def forget_all(self) -> None:
        self.forgotten += 1


@dataclass
class SpyReconciler:
    """记下对账跑了几轮。"""

    rounds: list[tuple[int, int]] = field(default_factory=list[tuple[int, int]])

    async def reconcile(self) -> tuple[int, int]:
        result = (0, 0)
        self.rounds.append(result)
        return result


@dataclass
class Harness:
    """一套装好的循环与它的三件假件。"""

    runtime: PublisherRuntime
    lease: FakeLease
    publisher: SpyPublisher
    reconciler: SpyReconciler


def build_harness(
    *,
    is_grantable: bool = True,
    is_renewable: bool = True,
    reconcile_interval_s: float = RECONCILE_INTERVAL_S,
) -> Harness:
    """装一套循环。

    Args: is_grantable, is_renewable, reconcile_interval_s。
    """
    lease = FakeLease(is_grantable=is_grantable, is_renewable=is_renewable)
    publisher = SpyPublisher()
    reconciler = SpyReconciler()
    # cast 不必要：三件假件都满足被替代者的最小面，运行期按结构用
    runtime = PublisherRuntime(
        lease=lease,
        publisher=publisher,  # pyright: ignore[reportArgumentType]
        reconciler=reconciler,  # pyright: ignore[reportArgumentType]
        options=LoopOptions(
            window_s=WINDOW_S, reconcile_interval_s=reconcile_interval_s
        ),
    )
    return Harness(
        runtime=runtime,
        lease=lease,
        publisher=publisher,
        reconciler=reconciler,
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
