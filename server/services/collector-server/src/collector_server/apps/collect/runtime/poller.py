"""通用轮询循环：驱动不支持订阅时的降级路径。

⚠ 轮询**只写这一遍**，不由每个驱动各写一份——各写一份必然在批大小、
失败处置与时刻口径上微妙地不一致，而不一致不会报错（ADR-0011）。
"""

import asyncio
import contextlib
import math
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field

from collector_server.apps.collect.drivers.base import (
    Driver,
    Sample,
    ValueSink,
)
from collector_server.clock import utc_now_ms
from lib.logging import get_logger

_logger = get_logger("collect.poller")

# 轮询周期下限：比它更密只会在工控网上堆包
MIN_POLL_INTERVAL_MS = 50


@dataclass(frozen=True)
class PollOptions:
    """轮询什么、多久一轮。"""

    point_codes: tuple[str, ...]
    interval_ms: int
    point_period_ms: Mapping[str, int] = field(default_factory=dict[str, int])


class PollLoop:
    """一个数据源的轮询循环。"""

    def __init__(
        self,
        *,
        driver: Driver,
        sink: ValueSink,
        options: PollOptions,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """按驱动与点位表初始化，构造时不起任务。

        Args: driver, sink, options。
        """
        self._driver = driver
        self._sink = sink
        self._codes = options.point_codes
        self._interval_s = max(options.interval_ms, MIN_POLL_INTERVAL_MS) / 1000
        self._period_s = {
            code: max(
                self._interval_s,
                options.point_period_ms.get(code, options.interval_ms) / 1000,
            )
            for code in self._codes
        }
        self._clock = clock
        self._stopped = asyncio.Event()

    async def run(self) -> None:
        """一直轮到被叫停。

        ⚠ 开头不许 `clear()`：`create_task` 之后这个任务不一定已经跑起来，
        叫停要是落在这之前就会被抹掉，于是循环永远转下去，而 `_stop_polling`
        正等着它退出——一条会话拆不掉，整个收敛循环跟着卡住。
        """
        deadlines = dict.fromkeys(self._codes, self._clock())
        while not self._stopped.is_set():
            now = self._clock()
            due = tuple(code for code in self._codes if deadlines[code] <= now)
            if due:
                await self._read(due)
                completed = self._clock()
                for code in due:
                    deadlines[code] = next_deadline(
                        deadlines[code], self._period_s[code], completed
                    )
            if not deadlines:
                wait_s = self._interval_s
            else:
                wait_s = max(0.0, min(deadlines.values()) - self._clock())
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._stopped.wait(), timeout=wait_s)

    def stop(self) -> None:
        """叫停。下一拍之前就会退出，不必等满一个周期。"""
        self._stopped.set()

    async def tick(self) -> None:
        """读一轮并喂给 sink。

        ⚠ 单轮失败只记日志不退出：判断线是心跳的活（session.py）。一次读超时
        就把会话拆掉，会让一次抖动变成一整轮重连。
        """
        await self._read(self._codes)

    async def _read(self, codes: Sequence[str]) -> None:
        if not codes:
            return
        try:
            samples = await self._driver.read_many(codes)
        except Exception as error:
            _logger.warning(
                "poll_read_failed",
                "轮询读取失败，本轮跳过",
                point_count=len(codes),
                error_type=type(error).__name__,
            )
            failed_at = utc_now_ms()
            for code in codes:
                self._sink(code, None, failed_at, "bad")
            return
        if len(samples) != len(codes):
            _logger.error(
                "poll_result_misaligned",
                "驱动返回的读数数量与请求不一致，本轮整批丢弃",
                requested_count=len(codes),
                sample_count=len(samples),
            )
            failed_at = utc_now_ms()
            for code in codes:
                self._sink(code, None, failed_at, "bad")
            return
        self._feed(codes, samples)

    def _feed(self, codes: Sequence[str], samples: Sequence[Sample]) -> None:
        """把逐位对齐的读数喂给 sink。

        ⚠ 靠位置对齐：驱动保证返回值与入参等长，短了就配错点位。

        Args: samples。
        """
        for code, (value, ts_ms, quality) in zip(codes, samples, strict=True):
            self._sink(code, value, ts_ms, quality)


def next_deadline(
    previous_s: float, period_s: float, completed_s: float
) -> float:
    """按固定节拍跳过错过的时隙，绝不追补突发轮询。

    Args: previous_s, period_s, completed_s。
    """
    missed = max(1, math.floor((completed_s - previous_s) / period_s) + 1)
    return previous_s + missed * period_s
