"""断路：连续失败到阈值就短路，冷却期过后放一次探测。

⚠ 状态**每进程一份**，不跨副本共享。共享要在每次调用前多一次 Redis 往返，
而那正是断路器想省掉的那段延迟；共享还会让一个副本自己的网络问题把所有副本
一起断掉。代价是各副本各自试探——下游恢复时会收到「副本数」那么多次探测，
这个量级远小于不设断路器时的全量重试。

⚠ 半开时只放**一个**探测过去。把等待中的调用一起放开，等于在下游刚要站起来
的时候再推它一把，而那通常足够让它重新倒下。

⚠ 打开状态必须**明确暴露**（日志 + 状态可读），否则表现成「下游明明好了但我
这边还在报错」，而没人知道是断路器还没合上（runtime-resilience §4.3）。
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from lib.errors import DependencyUnavailable
from lib.logging import get_logger
from lib.utils.timeutils import Clock, utcnow

BreakerState = Literal["closed", "open", "half_open"]

_logger = get_logger("lib.resilience.breaker")


class BreakerOpen(DependencyUnavailable):
    """断路器打开着，这次调用没有发出去。"""


@dataclass
class CircuitBreaker:
    """一个下游的断路器。

    `name` 只进日志字段，不参与 `event` 字面量——`event` 必须是稳定字面量，
    拼进变量会让同一类事件在日志里散成许多种。
    """

    name: str
    failure_threshold: int = 5
    reset_after_s: float = 30.0
    clock: Clock = utcnow

    _state: BreakerState = field(default="closed", init=False)
    _failures: int = field(default=0, init=False)
    _opened_at: datetime | None = field(default=None, init=False)
    # 半开期间是否已经有一个探测在路上
    _is_probing: bool = field(default=False, init=False)

    @property
    def state(self) -> BreakerState:
        """当前状态。读它会顺带把「冷却够了」的打开态推进到半开。"""
        self._settle()
        return self._state

    def allow(self) -> bool:
        """这次调用能不能发出去。半开时只有第一个调用能拿到 True。"""
        self._settle()
        if self._state == "closed":
            return True
        if self._state == "half_open" and not self._is_probing:
            self._is_probing = True
            return True
        return False

    def guard(self) -> None:
        """不能发就抛。给「调用前挡一道」的写法用。"""
        if not self.allow():
            raise BreakerOpen(f"{self.name} 暂时不可用")

    def record_success(self) -> None:
        """一次成功。半开时的成功会合上断路器。"""
        was_open = self._state != "closed"
        self._state = "closed"
        self._failures = 0
        self._opened_at = None
        self._is_probing = False
        if was_open:
            _logger.info(
                "breaker_closed", "下游恢复，断路器合上", breaker=self.name
            )

    def record_failure(self, reason: str = "") -> None:
        """一次失败。

        ⚠ `reason` 会进日志，所以调用方**不许**把 URL、密钥或响应体原文塞进来。

        Args: reason。
        """
        is_probe = self._state == "half_open"
        self._is_probing = False
        self._failures += 1
        # 半开时的一次失败直接重新打开：探测就是拿来判断「好没好」的
        if is_probe or self._failures >= self.failure_threshold:
            self._open(reason)

    def _open(self, reason: str) -> None:
        self._state = "open"
        self._opened_at = self.clock()
        _logger.warning(
            "breaker_opened",
            "连续失败达到阈值，断路器打开",
            breaker=self.name,
            failures=self._failures,
            reset_after_s=self.reset_after_s,
            reason=reason,
        )

    def _settle(self) -> None:
        """打开且冷却够了就转半开。"""
        if self._state != "open" or self._opened_at is None:
            return
        elapsed = (self.clock() - self._opened_at).total_seconds()
        if elapsed < self.reset_after_s:
            return
        self._state = "half_open"
        self._is_probing = False
        _logger.info(
            "breaker_half_open", "冷却结束，放一个探测", breaker=self.name
        )
