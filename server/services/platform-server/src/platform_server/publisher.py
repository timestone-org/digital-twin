"""publisher 角色的进程装配、发布循环与关停编排。

一个循环带**两条推送链路**：大屏（`dashboard:{id}`）与采集配置页
（`collect:{source_id}`）。合用一个进程与一把租约，是因为两者的单活理由完全
相同，而拆成两个角色会多出一份部署单元与一把互不相干的租约。
⚠ 两条链路各自兜错：一条出问题不许把另一条一起带走——现场大屏比配置页重要
得多，而配置页的一次读库失败没有理由让整屏停更。

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
from collections.abc import Awaitable, Callable
from contextvars import Token
from dataclasses import dataclass

from lib.lifespan import wait_for_termination
from lib.logging import (
    LogContext,
    bind_log_context,
    configure_logging,
    get_logger,
    reset_log_context,
)
from lib.utils.ids import uuid7
from platform_server.apps.collect.services.live_plan import (
    DatabaseLivePlanSource,
)
from platform_server.apps.collect.services.live_publisher import (
    LiveOptions,
    SourceLivePublisher,
)
from platform_server.apps.collect.services.topic_reconcile import (
    CollectTopicReconciler,
    DatabaseSourceIndex,
)
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


@dataclass(frozen=True)
class Lane:
    """一条推送链路：一个对账器 + 一个发布器，共用循环的节奏与租约。

    ⚠ `name` 进日志字段而不是拼进 `event`：`event` 必须是稳定字面量，拼了
    变量就再也 group by 不了（observability §1）。
    """

    name: str
    reconcile: Callable[[], Awaitable[object]]
    # ⚠ 不叫 `publish`：可观测性闸把 `.publish(` 一律当成「往队列投消息」，
    # 于是这一层会被要求带 traceparent，而真正投递发生在发布器内部
    tick: Callable[[], Awaitable[None]]
    forget_all: Callable[[], None]


class PublisherRuntime:
    """发布循环：持租约 → 逐条链路对账 → 逐条链路推一拍。"""

    def __init__(
        self,
        *,
        lease: Lease,
        lanes: tuple[Lane, ...],
        options: LoopOptions,
    ) -> None:
        """按租约与各条链路初始化，构造时不做 IO。

        Args: lease, lanes, options。
        """
        self._lease = lease
        self._lanes = lanes
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
        """跑一拍：续租约 → 每条链路各自对账并推一批。

        ⚠ 每一拍开头换一条 trace：一条几天不停的循环共用一个 trace_id，等于
        没有 trace（observability §3.2）。
        """
        token = _bind_tick_trace()
        try:
            if not await self._hold_lease():
                return
            is_due = self._is_reconcile_due()
            for lane in self._lanes:
                await self._run_lane(lane, is_reconcile_due=is_due)
        finally:
            reset_log_context(token)

    async def _run_lane(self, lane: Lane, *, is_reconcile_due: bool) -> None:
        """跑一条链路。

        ⚠ 就地兜错、不往外抛：抛出去就是「配置页那条链路读库失败，顺带让全
        厂大屏这一拍不更新」。哪条链路坏了由 `lane` 字段说清。
        Args: lane, is_reconcile_due。
        """
        try:
            if is_reconcile_due:
                await lane.reconcile()
            await lane.tick()
        except Exception as error:
            _logger.error(
                "publisher_lane_failed",
                "一条推送链路这一拍出错，另一条不受影响",
                lane=lane.name,
                error_type=type(error).__name__,
            )

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
        self._forget_all()
        await self._lease.release()
        _logger.info("publisher_lease_released", "已让出发布租约")

    def _forget_all(self) -> None:
        """丢掉每条链路的进程内缓存。"""
        for lane in self._lanes:
            lane.forget_all()

    async def _hold_lease(self) -> bool:
        """续或抢租约，返回此刻是不是 leader。

        ⚠ renew-or-die：续不上立刻判非 leader 并丢掉进程内缓存——接任者会从
        全量帧重新开始，而我们手上那份「已经推过什么」对它没有意义。
        """
        if self._is_leader:
            if await self._lease.renew():
                return True
            self._is_leader = False
            self._forget_all()
            _logger.error("publisher_lease_lost", "租约续期失败，立刻停止推送")
            return False
        is_acquired = await self._lease.acquire()
        if is_acquired:
            _logger.info(
                "publisher_lease_acquired", "接管实时发布，本副本成为 leader"
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
        lanes=(_dashboard_lane(container), _collect_lane(container)),
        options=LoopOptions(
            window_s=settings.publish_window_ms / MS_PER_S,
            reconcile_interval_s=settings.publish_reconcile_interval_s,
        ),
    )


def _dashboard_lane(container: Container) -> Lane:
    """大屏那条链路。

    Args: container。
    """
    settings = container.settings
    publisher = DashboardPublisher(
        plans=DatabasePlanSource(database=container.database),
        viewers=container.viewers,
        snapshots=container.snapshots,
        realtime=container.realtime,
        options=PublishOptions(max_items=settings.publish_max_items),
    )
    reconciler = TopicReconciler(
        dashboards=DatabaseDashboardIndex(database=container.database),
        realtime=container.realtime,
    )
    return Lane(
        name="dashboard",
        reconcile=reconciler.reconcile,
        tick=lambda: _publish_dashboards(publisher),
        forget_all=publisher.forget_all,
    )


def _collect_lane(container: Container) -> Lane:
    """采集配置页那条链路。

    Args: container。
    """
    settings = container.settings
    publisher = SourceLivePublisher(
        plans=DatabaseLivePlanSource(database=container.database),
        watchers=container.collect_watchers,
        snapshots=container.snapshots,
        realtime=container.realtime,
        options=LiveOptions(
            max_items=settings.publish_max_items,
            max_points=settings.collect_live_max_points,
            plan_ttl_s=settings.collect_live_plan_ttl_s,
        ),
    )
    reconciler = CollectTopicReconciler(
        sources=DatabaseSourceIndex(database=container.database),
        realtime=container.realtime,
    )
    return Lane(
        name="collect",
        reconcile=reconciler.reconcile,
        tick=lambda: _publish_collect(publisher),
        forget_all=publisher.forget_all,
    )


async def _publish_dashboards(publisher: DashboardPublisher) -> None:
    """推一拍大屏并记账。

    Args: publisher。
    """
    report = await publisher.publish_once()
    if report.items:
        _logger.info(
            "dashboard_values_published",
            "大屏实时值已推送",
            dashboards=report.dashboards,
            items=report.items,
        )


async def _publish_collect(publisher: SourceLivePublisher) -> None:
    """推一拍采集实时值并记账。

    Args: publisher。
    """
    report = await publisher.publish_once()
    if report.items:
        _logger.info(
            "collect_values_published",
            "采集实时值已推送",
            sources=report.sources,
            items=report.items,
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
    asyncio.run(serve(settings, wait=wait_for_termination))
