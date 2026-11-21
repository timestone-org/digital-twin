"""运行态出口：把会话报上来的状态写进 `collect` schema，供 platform 只读。"""

from collector_server.apps.collect.crud.source_state import SourceStateCrud
from collector_server.apps.collect.runtime.session import SourceStatus
from collector_server.lease import RedisLease
from lib.db import Database
from lib.logging import get_logger

_logger = get_logger("collect.state")


class SourceStateService:
    """事务边界在这里，crud 只出语句。"""

    def __init__(
        self, *, database: Database, instance: str, lease: RedisLease
    ) -> None:
        """按数据库句柄与本副本名初始化。

        Args: database, instance, lease。
        """
        self._database = database
        self._instance = instance
        self._lease = lease
        self._token = lease.token
        self._crud = SourceStateCrud()

    async def report(self, status: SourceStatus) -> None:
        """写一行运行态。

        ⚠ 写失败**只记日志不抛**：运行态是旁路数据，让它把采集会话拖垮是
        本末倒置——库不可达时该继续采，而不是停下来。

        Args: status。
        """
        token = self._token
        if token is None or token != self._lease.token:
            return
        try:
            async with self._database.session() as session:
                order = await self._crud.reserve_report_order(session)
            # 先取全局次序再核对租约：即使核对后暂停，新主上报仍能压过此条。
            if not await self._lease.is_current(token):
                return
            async with self._database.session() as session:
                await self._crud.upsert(
                    session, status, instance=self._instance, order=order
                )
        except Exception as error:
            _logger.error(
                "source_state_write_failed",
                "运行态写库失败，采集继续",
                source_id=str(status.source_id),
                state=status.state,
                error_type=type(error).__name__,
            )
