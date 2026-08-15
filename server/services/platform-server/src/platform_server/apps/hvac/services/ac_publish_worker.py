"""每分钟一拍的预测下发循环。worker 角色的第三条循环。

**必须单活**：worker 有多个副本，不加租约就是每个副本每分钟各写一遍同一批
点位。⚠ Redis 不可达一律判非 leader（runtime-resilience §7）——宁可这一拍没人
发，也不要两个进程往同一个点位各写各的。

⚠ 一拍的总预算小于一拍本身：跑过头会让下一拍从一开始就迟到，而迟到会累积。
到点即止，没轮到的模型下一拍再说——**不补**，因为补的是一份已经过时的预测。

口径见 docs/AC_PUBLISH_DESIGN.md §5。
"""

import asyncio
import contextlib
import uuid
from contextvars import Token
from dataclasses import dataclass

from lib.logging import (
    LogContext,
    bind_log_context,
    get_logger,
    reset_log_context,
)
from lib.utils.ids import uuid7
from platform_server.apps.hvac.publications import PUBLISH_STATUS_OK
from platform_server.apps.hvac.services import (
    ac_publication_service,
    ac_publish_service,
)
from platform_server.apps.hvac.services.ac_publish_service import Sessions
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.lease import Lease
from platform_server.opcua import NodeWriter

_logger = get_logger("platform.hvac.ac_publish_worker")

# 跨度的一半：trace_id 与 span_id 各取一段十六进制
_TRACE_ID_LENGTH = 32
_SPAN_ID_LENGTH = 16


@dataclass(frozen=True)
class PublishLoopOptions:
    """循环的节奏与预算。"""

    interval_s: float
    budget_s: float
    model_timeout_s: float


class PublishLoop:
    """发布循环：持租约 → 挑出该发的模型 → 挨个发到预算用完。"""

    def __init__(
        self,
        *,
        database: Sessions,
        lease: Lease,
        reader: AcSourceReader,
        nodes: NodeWriter,
        options: PublishLoopOptions,
    ) -> None:
        """按依赖与节奏初始化，构造时不做 IO。

        Args: database, lease, reader, nodes, options。
        """
        self._database = database
        self._lease = lease
        self._reader = reader
        self._nodes = nodes
        self._options = options
        self._stopped = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()
        self._is_leader = False

    @property
    def is_leader(self) -> bool:
        """此刻是否持有租约。"""
        return self._is_leader

    async def run(self) -> None:
        """主循环。

        ⚠ 一拍出错不许带走整个循环：带走了就再也不续租约、也不再下发，而进程
        还活着——这是最难察觉的一种停摆。
        """
        while not self._stopped.is_set():
            self._idle.clear()
            try:
                await self.tick()
            except Exception as error:
                _logger.error(
                    "ac_publish_tick_failed",
                    "下发循环这一拍出错，下一拍继续",
                    error_type=type(error).__name__,
                )
            finally:
                self._idle.set()
            await self._pause(self._options.interval_s)

    async def tick(self) -> None:
        """跑一拍：续租约 → 挑模型 → 挨个发。

        ⚠ 每一拍开头换一条 trace：一条几天不停的循环共用一个 trace_id 等于
        没有 trace，而 contextvars 不跨任务传播——不绑就取到一串全零，
        链路在「平台 → opcua-server」这一跳齐断。
        """
        token = _bind_tick_trace()
        try:
            if not await self._hold_lease():
                return
            await self._publish_due()
        finally:
            reset_log_context(token)

    def stop(self) -> None:
        """停收新活。⚠ 只置位，不等待——等在 `drain` 里做。"""
        self._stopped.set()

    async def drain(self, timeout_s: float) -> None:
        """等手上这一拍跑完。超时就不等了，让租约那一步照常进行。

        Args: timeout_s。
        """
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._idle.wait(), timeout=timeout_s)

    async def release(self) -> None:
        """让租约。持有才让，且让完就不再是 leader。"""
        if not self._is_leader:
            return
        self._is_leader = False
        await self._lease.release()
        _logger.info("ac_publish_lease_released", "已让出预测下发租约")

    async def _publish_due(self) -> None:
        """把该发的模型挨个发出去，跳过的单独记一条。

        Args: 无。
        """
        async with self._database.session() as session:
            due = await ac_publication_service.due_models(session)
        for entry in due.skipped:
            _logger.warning(
                "ac_publish_skipped",
                "这个模型已启用但绑定不全，本拍未下发",
                model_id=str(entry.model_id),
                reason=entry.reason,
            )
        await self._publish_each(due.ready)

    async def _publish_each(self, model_ids: tuple[uuid.UUID, ...]) -> None:
        """在整拍预算内挨个发。到点即止。

        ⚠ 顺序固定（`due_models` 按模型 id 升序）而预算会用完，故排在后面的
        模型可能一直轮不到。真发生时它自己的 `last_published_at` 会停住，
        页面据此报出来——这比悄悄少发一个房间好。

        Args: model_ids。
        """
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._options.budget_s
        for at, model_id in enumerate(model_ids):
            if loop.time() >= deadline:
                _logger.warning(
                    "ac_publish_budget_spent",
                    "一拍的预算用完了，剩下的模型下一拍再发",
                    remaining=len(model_ids) - at,
                )
                return
            await self._publish_one(model_id)

    async def _publish_one(self, model_id: uuid.UUID) -> None:
        """发一个模型。它自己出错不许打断这一拍里其余的模型。

        Args: model_id。
        """
        try:
            async with asyncio.timeout(self._options.model_timeout_s):
                outcome = await ac_publish_service.publish_once(
                    self._database,
                    self._reader,
                    self._nodes,
                    model_id=model_id,
                )
        except Exception as error:
            _logger.error(
                "ac_publish_model_failed",
                "这个模型这一拍没发出去，下一拍继续",
                model_id=str(model_id),
                error_type=type(error).__name__,
            )
            return
        _log_outcome(outcome)

    async def _hold_lease(self) -> bool:
        """续或抢租约，返回此刻是不是 leader。

        ⚠ renew-or-die：续不上立刻判非 leader。接任者会从头算一拍，
        而我们手上没有任何「已经写过什么」的状态需要交接——点位是覆盖语义。
        """
        if self._is_leader:
            if await self._lease.renew():
                return True
            self._is_leader = False
            _logger.error("ac_publish_lease_lost", "租约续期失败，立刻停止下发")
            return False
        is_acquired = await self._lease.acquire()
        if is_acquired:
            _logger.info(
                "ac_publish_lease_acquired",
                "接管预测下发，本副本成为 leader",
            )
        self._is_leader = is_acquired
        return is_acquired

    async def _pause(self, delay_s: float) -> None:
        """等到下一拍，被叫停就提前醒。

        Args: delay_s。
        """
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stopped.wait(), timeout=delay_s)


def _log_outcome(outcome: ac_publish_service.PublishOutcome) -> None:
    """一次下发的结论落进日志。

    ⚠ 成功与降级/失败是**两个** event：混成一条的话，一个每分钟都在写哨兵值
    的模型在日志里与正常下发的一模一样。

    Args: outcome。
    """
    if outcome.status == PUBLISH_STATUS_OK:
        _logger.info(
            "ac_publish_written",
            "预测已下发",
            model_id=str(outcome.model_id),
            written=outcome.written_count,
        )
        return
    _logger.warning(
        "ac_publish_degraded",
        "这一拍没有可下发的预测，点位已写哨兵值",
        model_id=str(outcome.model_id),
        status=outcome.status,
        written=outcome.written_count,
        reason=outcome.error,
    )


def _bind_tick_trace() -> Token[LogContext]:
    """给这一拍绑一条新的 trace，返回还原用的 token。"""
    return bind_log_context(
        trace_id=uuid7().hex[:_TRACE_ID_LENGTH],
        span_id=uuid7().hex[:_SPAN_ID_LENGTH],
        route="ac_publish.tick",
    )
