"""守通用轮询：读数按位置配点位、单轮失败不拆会话、叫停不必等满一个周期。"""

import asyncio

from collector_server.apps.collect.drivers.base import Sample
from collector_server.apps.collect.runtime.poller import (
    MIN_POLL_INTERVAL_MS,
    PollLoop,
    PollOptions,
    next_deadline,
)

TS_MS = 1_767_323_045_000


class StubDriver:
    """只回读数的假驱动。"""

    def __init__(
        self, samples: list[Sample], *, error: Exception | None = None
    ) -> None:
        self.samples = samples
        self.error = error
        self.calls = 0
        self.asked: tuple[str, ...] = ()

    async def read_many(self, point_codes: list[str]) -> list[Sample]:
        self.calls += 1
        self.asked = tuple(point_codes)
        if self.error is not None:
            raise self.error
        return self.samples


def _collector() -> tuple[list[tuple[str, object, int, str]], object]:
    seen: list[tuple[str, object, int, str]] = []

    def sink(point_code: str, value: object, ts_ms: int, quality: str) -> None:
        seen.append((point_code, value, ts_ms, quality))

    return seen, sink


async def test_readings_are_fed_in_the_requested_order() -> None:
    seen, sink = _collector()
    loop = PollLoop(
        driver=StubDriver([(1.0, TS_MS, "good"), (2.0, TS_MS, "bad")]),
        sink=sink,
        options=PollOptions(point_codes=("a", "b"), interval_ms=1000),
    )
    await loop.tick()
    assert seen == [
        ("a", 1.0, TS_MS, "good"),
        ("b", 2.0, TS_MS, "bad"),
    ]


async def test_empty_point_table_asks_nobody() -> None:
    driver = StubDriver([])
    loop = PollLoop(
        driver=driver,
        sink=lambda *_: None,
        options=PollOptions(point_codes=(), interval_ms=1000),
    )
    await loop.tick()
    assert driver.calls == 0


async def test_read_failure_skips_the_round_without_raising() -> None:
    seen, sink = _collector()
    loop = PollLoop(
        driver=StubDriver([], error=TimeoutError()),
        sink=sink,
        options=PollOptions(point_codes=("a",), interval_ms=1000),
    )
    await loop.tick()
    assert len(seen) == 1
    assert seen[0][0] == "a"
    assert seen[0][1] is None
    assert seen[0][3] == "bad"


async def test_short_result_is_dropped_instead_of_shifting_values() -> None:
    seen, sink = _collector()
    loop = PollLoop(
        driver=StubDriver([(1.0, TS_MS, "good")]),
        sink=sink,
        options=PollOptions(point_codes=("a", "b"), interval_ms=1000),
    )
    await loop.tick()
    assert [entry[0] for entry in seen] == ["a", "b"]
    assert all(entry[3] == "bad" for entry in seen)


async def test_stop_ends_the_loop_without_waiting_a_full_period() -> None:
    driver = StubDriver([(1.0, TS_MS, "good")])
    loop = PollLoop(
        driver=driver,
        sink=lambda *_: None,
        options=PollOptions(point_codes=("a",), interval_ms=60_000),
    )
    task = asyncio.create_task(loop.run())
    await asyncio.sleep(0)
    loop.stop()
    async with asyncio.timeout(1):
        await task
    assert driver.calls >= 1


async def test_stop_before_the_task_starts_is_not_swallowed() -> None:
    # ⚠ 没有 `sleep(0)`：叫停落在任务真正跑起来之前。`run()` 开头要是把停止位
    # 清掉，这个循环就永远转下去，而调用方正 await 它退出——一处死锁
    driver = StubDriver([(1.0, TS_MS, "good")])
    loop = PollLoop(
        driver=driver,
        sink=lambda *_: None,
        options=PollOptions(point_codes=("a",), interval_ms=60_000),
    )
    task = asyncio.create_task(loop.run())
    loop.stop()
    async with asyncio.timeout(1):
        await task
    assert driver.calls == 0


def test_poll_interval_never_goes_below_the_floor() -> None:
    loop = PollLoop(
        driver=StubDriver([]),
        sink=lambda *_: None,
        options=PollOptions(point_codes=("a",), interval_ms=1),
    )
    # 下限没有公开面，只能读内部
    assert loop._interval_s == MIN_POLL_INTERVAL_MS / 1000


def test_point_periods_respect_source_floor() -> None:
    loop = PollLoop(
        driver=StubDriver([]),
        sink=lambda *_: None,
        options=PollOptions(
            point_codes=("fast", "slow"),
            interval_ms=1000,
            point_period_ms={"fast": 100, "slow": 5000},
        ),
    )
    assert loop._period_s == {"fast": 1.0, "slow": 5.0}


def test_overrun_skips_missed_deadlines_without_catchup() -> None:
    assert next_deadline(10.0, 1.0, 12.3) == 13.0
    assert next_deadline(10.0, 1.0, 10.2) == 11.0
