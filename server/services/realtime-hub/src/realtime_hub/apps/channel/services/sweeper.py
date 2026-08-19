"""匿名连接的授权复核：撤回一枚票据之后，已经连着的那些也要断掉。

⚠ 少了这一支，「撤回」只对还没连上的人成立：一条已建立的连接手里握着握手
那一刻解出来的授权，此后再没有任何一处会去重判它——公开大屏一开就是几天，
那等于撤回从未发生（ADR-0014 §二 要求撤回必须是真的）。

⚠ 复核**只查本服务的库**，不打任何别的服务：它按周期跑在每个副本上，跨服务
调用会让一次业务侧抖动变成全副本的连接抖动。

⚠ 登录态连接不走这里：它们的复核挂在换票那条路上（`session.reauth`），而
按码重判匿名连接会把它唯一那条订阅退掉——它一个权限码都没有。
"""

import asyncio
import contextlib

from lib.logging import get_logger
from lib.utils.timeutils import utcnow
from realtime_hub.apps.channel.services.connections import (
    Connection,
    ConnectionRegistry,
)
from realtime_hub.apps.channel.services.grants import PublicGrantRegistry
from realtime_hub.apps.channel.services.session import (
    CLOSE_PUBLIC_GRANT_REVOKED,
    CLOSE_TOKEN_EXPIRED,
    is_expired,
)

_logger = get_logger("realtime.sweeper")


class PublicConnectionSweeper:
    """按周期复核本副本上的匿名连接。"""

    def __init__(
        self,
        *,
        connections: ConnectionRegistry,
        grants: PublicGrantRegistry,
        interval_s: float,
    ) -> None:
        self._connections = connections
        self._grants = grants
        self._interval_s = interval_s
        self._task: asyncio.Task[None] | None = None
        self._stopped = asyncio.Event()

    async def start(self) -> None:
        """起后台任务。重复调用是幂等的。"""
        if self._task is not None:
            return
        self._stopped.clear()
        # ⚠ 存强引用：asyncio 只持弱引用，不存的话任务可能在运行中被 GC 掉，
        # 表现是「撤回有时候不生效」，而且没有任何报错
        self._task = asyncio.create_task(
            self._run(), name="realtime-public-sweeper"
        )

    async def stop(self) -> None:
        """停后台任务并等它退出。"""
        task = self._task
        if task is None:
            return
        self._task = None
        self._stopped.set()
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    async def _run(self) -> None:
        """复核主循环。

        ⚠ 单轮失败只记日志、继续循环：库抖一下不该让复核这条支线永久停摆，
        而那种停摆是静默的。
        """
        while not self._stopped.is_set():
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(
                    self._stopped.wait(), timeout=self._interval_s
                )
            if self._stopped.is_set():
                return
            try:
                await self.sweep_once()
            except Exception as error:
                _logger.error(
                    "public_sweep_failed",
                    "匿名连接复核失败，下一轮再来",
                    error_type=type(error).__name__,
                )

    async def sweep_once(self) -> int:
        """复核一轮，返回关掉了几条连接。"""
        anonymous = await self._connections.anonymous()
        if not anonymous:
            return 0
        now = utcnow()
        # ⚠ 按 id 收集而不是按对象：`Connection` 是可变 dataclass，`in` 会去逐
        # 字段比较（连闭包一起），既慢又不该是判据
        expired = {item.id for item in anonymous if is_expired(item, now=now)}
        alive = await self._grants.alive(
            frozenset(
                item.grant.ticket_hash
                for item in anonymous
                if item.grant is not None
            )
        )
        closed = 0
        for connection in anonymous:
            grant = connection.grant
            if grant is None:  # pragma: no cover - anonymous() 已经筛过
                continue
            if connection.id in expired:
                closed += await self._close(connection, CLOSE_TOKEN_EXPIRED)
                continue
            # ⚠ 主题变了也要断：同一枚票据改指另一张屏是不该发生的，真发生了
            # 就说明推送方那边换了口径，而这条连接还订在旧主题上
            if alive.get(grant.ticket_hash) != grant.topic:
                closed += await self._close(
                    connection, CLOSE_PUBLIC_GRANT_REVOKED
                )
        if closed:
            _logger.info(
                "public_connections_closed",
                "复核后关掉了部分匿名连接",
                closed=closed,
                anonymous=len(anonymous),
            )
        return closed

    @staticmethod
    async def _close(connection: Connection, code: int) -> int:
        """关掉一条连接，返回 1 表示确实动了手。

        ⚠ 关不掉只记日志：对端可能已经走了，而摘除由收发循环的 finally 负责。

        Args: connection, code。
        """
        if connection.close is None:
            return 0
        try:
            await connection.close(code)
        except Exception as error:
            _logger.warning(
                "public_connection_close_failed",
                "关闭匿名连接失败，已跳过",
                error_type=type(error).__name__,
            )
            return 0
        return 1
