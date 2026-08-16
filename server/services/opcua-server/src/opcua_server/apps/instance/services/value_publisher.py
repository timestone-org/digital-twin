"""值变化的合并窗口与分片推送。

⚠ 节流归推送方，不归 hub（ADR-0007）：hub 一旦知道「哪些载荷可以合并」，
就又长出业务知识了。所以窗口、合并、分片全在这里。

⚠ 窗口内**同一个节点只留最后一个值**。上位机可以每秒写几十次同一个点，
逐次推会打爆通道，而中间那些值对看曲线的人没有意义——他要的是「现在多少」。
"""

import asyncio
import contextlib
import uuid
from typing import Any

from lib.logging import current_traceparent, get_logger
from lib.utils.timeutils import utcnow
from opcua_server.apps.instance.services.realtime import RealtimeClient

_logger = get_logger("opcua.value_publisher")

_MS_PER_S = 1000


class ValuePublisher:
    """按实例攒值变化，到点合并成一批推给 hub。"""

    def __init__(
        self,
        *,
        realtime: RealtimeClient,
        window_ms: int,
        max_items: int,
    ) -> None:
        self._realtime = realtime
        self._window_s = window_ms / _MS_PER_S
        self._max_items = max_items
        # 实例 → {节点标识: 最后一次的值}
        self._pending: dict[uuid.UUID, dict[str, object]] = {}
        # 实例 → 本窗口内第一次写值时的 traceparent。⚠ 必须在记录时捕获：
        # 冲刷跑在后台任务里，请求上下文早已不在，取到的只会是全零。
        self._trace: dict[uuid.UUID, str] = {}
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None

    async def record(
        self, instance_id: uuid.UUID, identifier: str, value: object
    ) -> None:
        """记一次值变化。同窗口内同一个节点后写覆盖先写。

        Args: instance_id, identifier, value。
        """
        async with self._lock:
            self._pending.setdefault(instance_id, {})[identifier] = value
            self._trace.setdefault(instance_id, current_traceparent())

    async def start(self) -> None:
        """起冲刷循环。重复调用是幂等的。

        ⚠ 任务句柄要存强引用：asyncio 只持弱引用，不存的话它可能在运行中被
        GC 掉，表现是「推送有时候到不了」，而且没有任何报错。
        """
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._run(), name="opcua-value-flush")

    async def stop(self) -> None:
        """停循环，并把攒着的最后一批推出去。

        ⚠ 先停再冲刷：反过来的话，冲刷期间新记进来的值又攒下了一批，
        关停会一直追着尾巴。
        """
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await self.flush()

    async def flush(self) -> None:
        """把当前攒下的全部值推出去。

        ⚠ 先整体取走再逐个推：推送是外部 IO，占着锁做它会把这段时间内所有
        写值都堵在 `record` 上。
        """
        async with self._lock:
            batch = self._pending
            traces = self._trace
            self._pending = {}
            self._trace = {}
        for instance_id, values in batch.items():
            await self._publish(instance_id, values, traces.get(instance_id))

    async def _run(self) -> None:
        """按窗口周期冲刷。

        ⚠ 单次失败只记日志、继续下一轮：一次 hub 抖动不该让同进程里的全部
        实例从此再也不推值。
        """
        while True:
            await asyncio.sleep(self._window_s)
            try:
                await self.flush()
            except Exception as error:
                _logger.error(
                    "value_flush_failed",
                    "冲刷值变化失败，下一轮继续",
                    error_type=type(error).__name__,
                )

    async def _publish(
        self,
        instance_id: uuid.UUID,
        values: dict[str, object],
        traceparent: str | None,
    ) -> None:
        """把一个实例的一批值分片推出去，带上写值那一刻的 traceparent。

        Args: instance_id, values, traceparent。
        """
        items = [
            {"identifier": identifier, "value": value}
            for identifier, value in values.items()
        ]
        for shard in _shards(items, self._max_items):
            sent = await self._realtime.publish(
                instance_id, shard, traceparent=traceparent
            )
            if not sent:
                # ⚠ 不重推：一条链路只有一层负责重试，而这一层重试会与
                # 下一个窗口的推送抢顺序——客户端据 seq 发现丢帧后自己补
                _logger.warning(
                    "value_batch_dropped",
                    "一批值变化没能推出去，客户端会看到 seq 缺口",
                    instance_id=str(instance_id),
                    items=len(shard),
                    at=utcnow().isoformat(),
                )
                return


def _shards(
    items: list[dict[str, Any]], size: int
) -> list[list[dict[str, Any]]]:
    """按上限切片。

    ⚠ 分片在这里做而不是让 hub 拆：hub 拒收超限载荷，正是要求推送方自己切。
    Args: items, size。
    """
    return [items[start : start + size] for start in range(0, len(items), size)]
