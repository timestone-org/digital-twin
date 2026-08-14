"""publisher 角色的进程装配、发布循环与关停编排。

**全局单活**：靠 Redis 租约选主（ARCHITECTURE §2.2），热备只是在等租约。
⚠ Redis 不可达一律判非 leader（runtime-resilience §6.2）——宁可这一拍没人推，
也不要两个进程对同一个主题各推各的。

⚠ 本角色**不挂任何探针**：它不接流量，「摘掉它」没有意义。能不能干活由租约
与推送日志说话，而不是由一个没人调的 `/ready` 说话。

⚠ 关停顺序 = 停收新活 → drain → **让租约** → 关资源，不是启动顺序的逆序
（runtime-resilience §8）。让租约排在关资源之前：让位比等它自然过期快一个
TTL，热备能立刻接管，而不是让大屏静默一整个 TTL。
"""

import asyncio
import contextlib
import signal
from collections.abc import Awaitable, Callable
from contextvars import Token
from dataclasses import dataclass

from lib.logging import (
    LogContext,
    bind_log_context,
    configure_logging,
    get_logger,
    reset_log_context,
)
from lib.utils.ids import uuid7
from platform_server.apps.dashboard.services import TopicReconciler

# ⚠ 按子模块 import 而不是走 services 清单：发布面反向依赖 apps/collect 的
# 快照公开面，进清单就是一个 import 期的环（见该清单的文件头）
from platform_server.apps.dashboard.services.publish_plan import (
    DatabaseDashboardIndex,
    DatabasePlanSource,
)
from platform_server.apps.dashboard.services.publish_service import (
    DashboardPublisher,
    PublishOptions,
)
from platform_server.container import Container, build_container
from platform_server.lease import Lease
from platform_server.settings import Settings

_logger = get_logger("platform.publisher")

MS_PER_S = 1000
# 跨度的一半：trace_id 与 span_id 各取一段十六进制
_TRACE_ID_LENGTH = 32
_SPAN_ID_LENGTH = 16

Wait = Callable[[], Awaitable[None]]


@dataclass(frozen=True)
class LoopOptions:
    """循环的节奏。"""

    window_s: float
    reconcile_interval_s: float


class PublisherRuntime:
    """发布循环：持租约 → 对账主题 → 推一拍。"""

    def __init__(
        self,
        *,
        lease: Lease,
        publisher: DashboardPublisher,
        reconciler: TopicReconciler,
        options: LoopOptions,
    ) -> None:
        """按租约、发布器与对账器初始化，构造时不做 IO。

        Args: lease, publisher, reconciler, options。
        """
        self._lease = lease
        self._publisher = publisher
        self._reconciler = reconciler
        self._options = options
        self._stopped = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()
        self._is_leader = False
        self._reconciled_at_s = 0.0

    @property
    def is_leader(self) -> bool:
        """此刻是否持有租约。"""
        return self._is_leader

    async def run(self) -> None:
        """主循环。

        ⚠ 一拍出错不许带走整个循环：带走了就再也不续租约、也不再推送，而进程
        还活着——这是最难察觉的一种停摆。
        """
        while not self._stopped.is_set():
            self._idle.clear()
            try:
                await self.tick()
            except Exception as error:
                _logger.error(
                    "publisher_tick_failed",
                    "发布循环这一拍出错，下一拍继续",
                    error_type=type(error).__name__,
                )
            finally:
                self._idle.set()
            await self._pause(self._options.window_s)

    async def tick(self) -> None:
        """跑一拍：续租约 → 到点对账 → 推一批。

        ⚠ 每一拍开头换一条 trace：一条几天不停的循环共用一个 trace_id，等于
        没有 trace（observability §3.2）。
        """
        token = _bind_tick_trace()
        try:
            if not await self._hold_lease():
                return
            if self._is_reconcile_due():
                await self._reconciler.reconcile()
            report = await self._publisher.publish_once()
            if report.items:
                _logger.info(
                    "dashboard_values_published",
                    "大屏实时值已推送",
                    dashboards=report.dashboards,
                    items=report.items,
                )
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
        self._publisher.forget_all()
        await self._lease.release()
        _logger.info("publisher_lease_released", "已让出大屏发布租约")

    async def _hold_lease(self) -> bool:
        """续或抢租约，返回此刻是不是 leader。

        ⚠ renew-or-die：续不上立刻判非 leader 并丢掉进程内缓存——接任者会从
        全量帧重新开始，而我们手上那份「已经推过什么」对它没有意义。
        """
        if self._is_leader:
            if await self._lease.renew():
                return True
            self._is_leader = False
            self._publisher.forget_all()
            _logger.error("publisher_lease_lost", "租约续期失败，立刻停止推送")
            return False
        is_acquired = await self._lease.acquire()
        if is_acquired:
            _logger.info(
                "publisher_lease_acquired", "接管大屏发布，本副本成为 leader"
            )
        self._is_leader = is_acquired
        return is_acquired

    def _is_reconcile_due(self) -> bool:
        """到该对账的时候了吗。"""
        now_s = asyncio.get_running_loop().time()
        if now_s - self._reconciled_at_s < self._options.reconcile_interval_s:
            return False
        self._reconciled_at_s = now_s
        return True

    async def _pause(self, delay_s: float) -> None:
        """等一个合并窗口，被叫停就提前醒。

        Args: delay_s。
        """
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stopped.wait(), timeout=delay_s)


def build_runtime(container: Container) -> PublisherRuntime:
    """按配置装出发布循环。

    Args: container。
    """
    settings = container.settings
    return PublisherRuntime(
        lease=container.lease,
        publisher=DashboardPublisher(
            plans=DatabasePlanSource(database=container.database),
            viewers=container.viewers,
            snapshots=container.snapshots,
            realtime=container.realtime,
            options=PublishOptions(
                max_items=settings.publish_max_items,
                stale_after_ms=settings.publish_stale_after_ms,
            ),
        ),
        reconciler=TopicReconciler(
            dashboards=DatabaseDashboardIndex(database=container.database),
            realtime=container.realtime,
        ),
        options=LoopOptions(
            window_s=settings.publish_window_ms / MS_PER_S,
            reconcile_interval_s=settings.publish_reconcile_interval_s,
        ),
    )


async def selfcheck(container: Container) -> None:
    """启动自检：把依赖可达性写进日志，不可达不阻断启动。

    ⚠ 不可达也要起来：hub 或 Redis 抖动时本角色的降级方向是「没有实时通道」，
    不是「进程起不来」。
    Args: container。
    """
    settings = container.settings
    _logger.info(
        "publisher_selfcheck",
        "publisher 依赖自检",
        postgres=settings.postgres_target(),
        redis=settings.redis_target(),
        is_postgres_reachable=await container.database.ping(),
        is_redis_reachable=await container.snapshots.ping(),
    )


@dataclass(frozen=True)
class PublisherProcess:
    """一次 publisher 运行：跑什么、等什么信号、到点关谁。"""

    runtime: PublisherRuntime
    container: Container
    wait: Wait


async def run_until_stopped(
    process: PublisherProcess, *, drain_timeout_s: float
) -> None:
    """跑起发布循环，收到信号后按顺序收摊。

    ⚠ 顺序不能换：停收新活 → drain → 让租约 → 关资源。让租约排在关资源之前，
    热备才能在我们还连得上 Redis 的时候接过去；排在 drain 之后，是因为让位时
    手上那一拍必须已经推完，否则接任者与我们会同时推同一个主题。
    Args: process, drain_timeout_s。
    """
    # ⚠ 强引用：事件循环只持有任务的弱引用，丢了引用的任务可能随时消失
    task = asyncio.create_task(process.runtime.run())
    try:
        await process.wait()
    finally:
        process.runtime.stop()
        await process.runtime.drain(drain_timeout_s)
        task.cancel()
        # ⚠ 取消之后要等它真的停：不等就可能在它还握着连接的时候关掉连接池
        with contextlib.suppress(asyncio.CancelledError):
            await task
        await process.runtime.release()
        await _release(process.container)
    _logger.info("publisher_stopped", "publisher 已退出")


async def _release(container: Container) -> None:
    """关掉长生命周期资源。连接池最后关：前面几件收尾时还要用它。

    Args: container。
    """
    await container.snapshots.close()
    await container.lease.close()
    await container.viewer_database.dispose()
    await container.database.dispose()


def _bind_tick_trace() -> Token[LogContext]:
    """给这一拍绑一条新的 trace，返回还原用的 token。"""
    return bind_log_context(
        trace_id=uuid7().hex[:_TRACE_ID_LENGTH],
        span_id=uuid7().hex[:_SPAN_ID_LENGTH],
        route="publisher.tick",
    )


async def serve(settings: Settings, *, wait: Wait) -> None:
    """装配并跑到收到终止信号为止。

    Args: settings, wait。
    """
    container = build_container(settings)
    await selfcheck(container)
    await run_until_stopped(
        PublisherProcess(
            runtime=build_runtime(container), container=container, wait=wait
        ),
        drain_timeout_s=settings.app_drain_timeout_s,
    )


async def wait_for_signal() -> None:  # pragma: no cover - 要真实进程信号
    """等 SIGTERM / SIGINT。收到即返回，由调用方按顺序收摊。"""
    loop = asyncio.get_running_loop()
    stopped = asyncio.Event()
    for name in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(name, stopped.set)
    await stopped.wait()


def run(settings: Settings) -> None:  # pragma: no cover - 进程入口
    """publisher 角色的入口。

    Args: settings。
    """
    configure_logging(
        service=settings.app_name,
        role=settings.app_role,
        instance=settings.app_instance,
        level=settings.app_log_level,
        log_format=settings.app_log_format,
    )
    asyncio.run(serve(settings, wait=wait_for_signal))
