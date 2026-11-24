"""OPC UA 订阅坏质量的主动核验与重建判定。"""

import math
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from itertools import islice
from time import monotonic

from asyncua import ua

from collector_server.apps.collect.drivers.base import (
    DriverNotConnected,
    Sample,
)
from lib.logging import get_logger
from timeseries import Quality

_logger = get_logger("collect.driver.opcua")
BAD_QUALITY_GRACE_S = 30.0
RECOVERY_COOLDOWN_S = 120.0
ReadMany = Callable[[Sequence[str]], Awaitable[list[Sample]]]


@dataclass(frozen=True)
class _BadQualityPeriod:
    started_s: float


class BadQualityMonitor:
    """按点位记录本次连续坏质量的起点。"""

    def __init__(self) -> None:
        self._periods: dict[str, _BadQualityPeriod] = {}

    def observe(self, point_code: str, quality: Quality) -> None:
        """记录已放行的采样质量。Args: point_code, quality。"""
        if quality != "bad":
            self.forget(point_code)
        elif point_code not in self._periods:
            self._periods[point_code] = _BadQualityPeriod(monotonic())

    def forget(self, point_code: str) -> None:
        """清除点位的坏质量状态。Args: point_code。"""
        self._periods.pop(point_code, None)

    def take_due(self, limit: int) -> dict[str, _BadQualityPeriod]:
        """轮换检查一批持续坏质量的点位。Args: limit。"""
        now_s = monotonic()
        due: dict[str, _BadQualityPeriod] = {}
        for point_code in tuple(islice(self._periods, limit)):
            period = self._periods.pop(point_code)
            self._periods[point_code] = period
            if now_s - period.started_s >= BAD_QUALITY_GRACE_S:
                due[point_code] = period
        return due

    def is_same_period(
        self, point_code: str, period: _BadQualityPeriod
    ) -> bool:
        """确认直读期间点位仍处在同一段坏质量。Args: point_code, period。"""
        return self._periods.get(point_code) is period


class SubscriptionRecovery:
    """在单个数据源的心跳里核验是否需要重建会话。"""

    def __init__(self, *, batch_size: int) -> None:
        self._batch_size = batch_size
        self._next_recovery_s = 0.0

    async def check(
        self,
        monitor: BadQualityMonitor,
        read_many: ReadMany,
        *,
        is_current: Callable[[str], bool],
    ) -> None:
        """直读证实订阅滞留时，请会话循环重连。

        Args: monitor, read_many, is_current。
        """
        if monotonic() < self._next_recovery_s:
            return
        candidates = {
            code: period
            for code, period in monitor.take_due(self._batch_size).items()
            if is_current(code)
        }
        if not candidates:
            return
        try:
            samples = await read_many(list(candidates))
        except (OSError, ua.UaError, DriverNotConnected) as error:
            _logger.warning(
                "opcua_subscription_probe_failed",
                "订阅质量复核读取失败，保留现有订阅",
                error_type=type(error).__name__,
            )
            return
        recovered_count = sum(
            _is_usable(sample)
            and monitor.is_same_period(code, period)
            and is_current(code)
            for (code, period), sample in zip(
                candidates.items(), samples, strict=True
            )
        )
        if recovered_count:
            self._next_recovery_s = monotonic() + RECOVERY_COOLDOWN_S
            _logger.warning(
                "opcua_subscription_recovery_requested",
                "主动读取证实点位已恢复，重建 OPC UA 数据源会话",
                point_count=recovered_count,
            )
            raise DriverNotConnected("OPC UA 订阅持续坏质量，主动读值已恢复")


def _is_usable(sample: Sample) -> bool:
    """判断直读是否证实点位恢复。Args: sample。"""
    value, _, quality = sample
    return (
        quality == "good"
        and value is not None
        and (not isinstance(value, float) or math.isfinite(value))
    )
