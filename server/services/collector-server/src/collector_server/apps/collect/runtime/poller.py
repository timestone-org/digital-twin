"""通用轮询循环：驱动不支持订阅时的降级路径。

⚠ 轮询**只写这一遍**，不由每个驱动各写一份——各写一份必然在批大小、
失败处置与时刻口径上微妙地不一致，而不一致不会报错（ADR-0011）。
"""

import asyncio
import contextlib
from collections.abc import Sequence
from dataclasses import dataclass

from collector_server.apps.collect.drivers.base import (
    Driver,
    Sample,
    ValueSink,
)
from lib.logging import get_logger

_logger = get_logger("collect.poller")

# 轮询周期下限：比它更密只会在工控网上堆包
MIN_POLL_INTERVAL_MS = 50


@dataclass(frozen=True)
class PollOptions:
    """轮询什么、多久一轮。"""

    point_codes: tuple[str, ...]
    interval_ms: int


class PollLoop:
    """一个数据源的轮询循环。"""

    def __init__(
        self, *, driver: Driver, sink: ValueSink, options: PollOptions
    ) -> None:
        """按驱动与点位表初始化，构造时不起任务。

        Args: driver, sink, options。
        """
        self._driver = driver
        self._sink = sink
        self._codes = options.point_codes
        self._interval_s = max(options.interval_ms, MIN_POLL_INTERVAL_MS) / 1000
        self._stopped = asyncio.Event()

    async def run(self) -> None:
        """一直轮到被叫停。

        ⚠ 开头不许 `clear()`：`create_task` 之后这个任务不一定已经跑起来，
        叫停要是落在这之前就会被抹掉，于是循环永远转下去，而 `_stop_polling`
        正等着它退出——一条会话拆不掉，整个收敛循环跟着卡住。
        """
        while not self._stopped.is_set():
            await self.tick()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(
                    self._stopped.wait(), timeout=self._interval_s
                )

    def stop(self) -> None:
        """叫停。下一拍之前就会退出，不必等满一个周期。"""
        self._stopped.set()

    async def tick(self) -> None:
        """读一轮并喂给 sink。

        ⚠ 单轮失败只记日志不退出：判断线是心跳的活（session.py）。一次读超时
        就把会话拆掉，会让一次抖动变成一整轮重连。
        """
        if not self._codes:
            return
        try:
            samples = await self._driver.read_many(self._codes)
        except Exception as error:
            _logger.warning(
                "poll_read_failed",
                "轮询读取失败，本轮跳过",
                point_count=len(self._codes),
                error_type=type(error).__name__,
            )
            return
        self._feed(samples)

    def _feed(self, samples: Sequence[Sample]) -> None:
        """把逐位对齐的读数喂给 sink。

        ⚠ 靠位置对齐：驱动保证返回值与入参等长，短了就配错点位。

        Args: samples。
        """
        for code, (value, ts_ms, quality) in zip(
            self._codes, samples, strict=False
        ):
            self._sink(code, value, ts_ms, quality)
