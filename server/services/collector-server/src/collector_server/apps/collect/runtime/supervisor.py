"""选主 + 计划比对 + 收敛：决定哪些会话该活着。

单活与计划的口径见 COLLECT_DESIGN.md §4.4，关停顺序见 §4.5。
"""

import asyncio
import contextlib
from collections.abc import Callable
from dataclasses import dataclass
from uuid import UUID

from collector_server.apps.collect.plan.adapt import without_points
from collector_server.apps.collect.plan.store import PlanStore
from collector_server.apps.collect.runtime.session import SourceSession
from collector_server.clock import Clock, utc_now_ms
from collector_server.lease import Lease
from collectwire import PlanSource
from lib.logging import get_logger

_logger = get_logger("collect.supervisor")

# 单活租约的键。⚠ 全系统只有这一个采集主，键名写死在这里而不是配置里：
# 让它可配等于让两套配置各选一个主
LEASE_KEY = "collect:leader"
# 租约存活期与续期周期。⚠ 续期必须远快于 TTL：一次网络抖动不该丢主，
# 而丢主意味着现场设备上要重建一整轮会话
LEASE_TTL_S = 15
LEASE_RENEW_INTERVAL_S = 5.0

MS_PER_S = 1000

SessionBuilder = Callable[[PlanSource], SourceSession]


@dataclass(frozen=True)
class SupervisorOptions:
    """主循环的节奏。"""

    plan_refresh_interval_s: float


class CollectSupervisor:
    """采集运行时的总控。一个进程一份。"""

    def __init__(
        self,
        *,
        lease: Lease,
        plan: PlanStore,
        builder: SessionBuilder,
        options: SupervisorOptions,
        clock: Clock = utc_now_ms,
    ) -> None:
        """按租约、计划与会话工厂初始化，构造时不做 IO。

        Args: lease, plan, builder, options, clock。
        """
        self._lease = lease
        self._plan = plan
        self._builder = builder
        self._options = options
        self._clock = clock
        self._sessions: dict[UUID, SourceSession] = {}
        self._applied: dict[UUID, PlanSource] = {}
        # ⚠ 强引用：事件循环只持有任务的弱引用，丢了引用的任务可能随时消失
        self._tasks: dict[UUID, asyncio.Task[None]] = {}
        self._loop_task: asyncio.Task[None] | None = None
        self._stopped = asyncio.Event()
        self._is_leader = False
        self._planned_at_ms = 0

    @property
    def is_leader(self) -> bool:
        """此刻是否持有租约。"""
        return self._is_leader

    @property
    def plan(self) -> PlanStore:
        """当前的计划仓。启动自检要靠它拉第一份计划。"""
        return self._plan

    def session_of(self, source_id: UUID) -> SourceSession | None:
        """取一个数据源活着的会话。命令总线要靠它执行浏览与读写。

        Args: source_id。
        """
        return self._sessions.get(source_id)

    async def start(self) -> None:
        """起主循环。"""
        self._stopped.clear()
        self._loop_task = asyncio.create_task(self.run())

    async def stop(self) -> None:
        """关停：心跳停 → 拆订阅/轮询 → 让租约。

        ⚠ 让租约排在**拆会话之后**，与 runtime-resilience §8 的通例相反：先
        让位会让热备在我们还握着现场会话时连上去，而重复会话击穿设备的会话
        上限正是本服务的头号故障（ARCHITECTURE §1）。多等的那一小会儿远比
        双份会话便宜。
        """
        self._stopped.set()
        await self._stop_loop()
        await self._stand_down()
        if self._is_leader:
            await self._lease.release()
            self._is_leader = False
            _logger.info("lease_released", "已让出采集租约")

    async def run(self) -> None:
        """主循环：续约 → 比对计划 → 收敛。

        ⚠ 一拍出错不许带走整个循环：带走了就再也不续租约、也不再收敛，而进程
        还活着、探针还绿着——这是最难察觉的一种停摆。
        """
        while not self._stopped.is_set():
            try:
                await self.tick()
            except Exception as error:
                _logger.error(
                    "supervisor_tick_failed",
                    "主循环这一拍出错，下一拍继续",
                    error_type=type(error).__name__,
                )
            await self._pause(LEASE_RENEW_INTERVAL_S)

    async def tick(self) -> None:
        """跑一拍。"""
        was_leader = self._is_leader
        if not await self._hold_lease():
            if was_leader:
                await self._stand_down()
            return
        is_changed = not was_leader
        if self._is_plan_due():
            is_changed = await self._plan.refresh() or is_changed
        if is_changed:
            await self.converge()

    async def converge(self) -> None:
        """让活着的会话与计划一致。"""
        plan = self._plan.current
        if plan is None:
            # ⚠ 拿不到计划就空转，且每一拍都响亮：不许拿旧计划顶上（ADR-0001）
            _logger.error(
                "plan_missing", "还没有采集计划，采集空转中，未建立任何会话"
            )
            return
        wanted = {source.source_id: source for source in plan.sources}
        for source_id in list(self._sessions):
            if source_id not in wanted:
                await self._drop(source_id)
        for source in wanted.values():
            await self._ensure(source)

    async def _ensure(self, source: PlanSource) -> None:
        """按计划里的一个数据源收敛出一条会话。

        Args: source。
        """
        running = self._sessions.get(source.source_id)
        applied = self._applied.get(source.source_id)
        if running is None:
            await self._launch(source)
            return
        is_rebuilt = applied is None or without_points(
            applied
        ) != without_points(source)
        if is_rebuilt:
            # 连接参数变了：整条重建，光换点位救不回来
            await self._drop(source.source_id)
            await self._launch(source)
            return
        self._applied[source.source_id] = source
        await running.apply(source)

    async def _launch(self, source: PlanSource) -> None:
        """起一条会话。

        Args: source。
        """
        session = self._builder(source)
        self._sessions[source.source_id] = session
        self._applied[source.source_id] = source
        self._tasks[source.source_id] = asyncio.create_task(session.run())
        _logger.info(
            "source_session_started",
            "数据源会话已启动",
            source_id=str(source.source_id),
            protocol=source.protocol,
            point_count=len(source.points),
        )

    async def _drop(self, source_id: UUID) -> None:
        """拆一条会话。

        Args: source_id。
        """
        session = self._sessions.pop(source_id, None)
        task = self._tasks.pop(source_id, None)
        self._applied.pop(source_id, None)
        if session is not None:
            await session.stop()
        if task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        _logger.info(
            "source_session_stopped",
            "数据源会话已拆除",
            source_id=str(source_id),
        )

    async def _stand_down(self) -> None:
        """拆掉全部会话。丢主与关停都走这里。"""
        for source_id in list(self._sessions):
            await self._drop(source_id)

    async def _hold_lease(self) -> bool:
        """续或抢租约，返回此刻是不是 leader。

        ⚠ renew-or-die：续不上立刻判非 leader 并停手，把脑裂窗口压在一个 TTL
        之内。Redis 不可达时 `Lease` 一律返回 False，方向同此。
        """
        if self._is_leader:
            if await self._lease.renew():
                return True
            self._is_leader = False
            _logger.error("lease_lost", "租约续期失败，立刻停止采集并让位")
            return False
        acquired = await self._lease.acquire()
        if acquired and not self._is_leader:
            _logger.info("lease_acquired", "接管采集，本副本成为 leader")
        self._is_leader = acquired
        return acquired

    def _is_plan_due(self) -> bool:
        """到该重拉计划的时候了吗。"""
        now_ms = self._clock()
        due_ms = int(self._options.plan_refresh_interval_s * MS_PER_S)
        if now_ms - self._planned_at_ms < due_ms:
            return False
        self._planned_at_ms = now_ms
        return True

    async def _stop_loop(self) -> None:
        """停主循环并等它退出。"""
        task, self._loop_task = self._loop_task, None
        if task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _pause(self, delay_s: float) -> None:
        """等一拍，被叫停就提前醒。

        Args: delay_s。
        """
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stopped.wait(), timeout=delay_s)
