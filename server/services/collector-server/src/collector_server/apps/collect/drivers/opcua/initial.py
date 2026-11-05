"""为每个成功订阅的 OPC UA 点位分批主动读取初值。"""

from collections.abc import Awaitable, Callable, Sequence

from collector_server.apps.collect.drivers.base import Sample
from collector_server.apps.collect.drivers.opcua.notifier import (
    DataChangeNotifier,
)
from lib.logging import get_logger

_logger = get_logger("collect.driver.opcua")

ReadMany = Callable[[Sequence[str]], Awaitable[list[Sample]]]


async def read_initial(
    point_codes: Sequence[str],
    *,
    read_many: ReadMany,
    notifier: DataChangeNotifier,
    batch_size: int,
) -> None:
    """主动读取初值，单批失败保留订阅并继续后续批次。"""
    for start in range(0, len(point_codes), batch_size):
        pending = notifier.prepare_initial(
            point_codes[start : start + batch_size]
        )
        if not pending:
            continue
        try:
            samples = await read_many(list(pending))
        except Exception as error:
            _logger.warning(
                "opcua_initial_read_failed",
                "点位初值补读失败，保留订阅继续等待通知",
                point_count=len(pending),
                error_type=type(error).__name__,
            )
            continue
        for code, sample in zip(pending, samples, strict=True):
            notifier.feed_initial(code, sample, version=pending[code])
