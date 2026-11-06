"""点位索引消费者的关停。"""

import asyncio
from typing import Any, cast

from platform_server.apps.collect.services.point_index_worker import (
    PointIndexWorker,
)


async def test_a_drain_that_runs_out_of_time_does_not_raise() -> None:
    worker = PointIndexWorker(database=cast(Any, object()), cipher=None)

    # ⚠ 抛出去的话 worker 的关停序列就此中断：其余任务不取消、租约不让、连接池不关
    await asyncio.wait_for(worker.drain(0.01), timeout=2)


async def test_a_drain_returns_at_once_when_idle() -> None:
    worker = PointIndexWorker(database=cast(Any, object()), cipher=None)
    worker.stop()
    await worker.run()

    await asyncio.wait_for(worker.drain(5.0), timeout=2)
