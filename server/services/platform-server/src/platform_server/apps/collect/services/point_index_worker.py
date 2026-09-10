"""点位索引的周期对账，嵌入在短事务之间执行。"""

import asyncio
from dataclasses import dataclass, field

from lib.crypto import SecretCipher
from lib.logging import (
    bind_log_context,
    get_logger,
    new_trace_id,
    reset_log_context,
)
from platform_server.apps.collect.crud import point_semantic
from platform_server.apps.collect.services.point_embedding import (
    PointSessions,
    embed_texts,
    load_profile,
)

_logger = get_logger("platform.collect.index")
INDEX_INTERVAL_S = 5.0


@dataclass
class PointIndexWorker:
    """可重入的索引消费者；条件 upsert 拦住过期结果。"""

    database: PointSessions
    cipher: SecretCipher | None
    _stopped: asyncio.Event = field(default_factory=asyncio.Event, init=False)
    _idle: asyncio.Event = field(default_factory=asyncio.Event, init=False)

    def stop(self) -> None:
        self._stopped.set()

    async def drain(self, timeout_s: float) -> None:
        """等待当前批次收尾。Args: timeout_s。"""
        async with asyncio.timeout(timeout_s):
            await self._idle.wait()

    async def run(self) -> None:
        """周期对账，不让一次失败终止后续索引。"""
        self._idle.set()
        while not self._stopped.is_set():
            self._idle.clear()
            context = bind_log_context(trace_id=new_trace_id())
            try:
                await self.run_once()
            except Exception as error:
                _logger.warning(
                    "point_index_batch_failed",
                    "点位索引批次失败",
                    error_type=type(error).__name__,
                )
            finally:
                reset_log_context(context)
                self._idle.set()
            try:
                async with asyncio.timeout(INDEX_INTERVAL_S):
                    await self._stopped.wait()
            except TimeoutError:
                continue

    async def run_once(self) -> int:
        """对账一批，返回已计算条数。"""
        profile = await load_profile(self.database, self.cipher)
        if profile is None:
            return 0
        async with self.database.session() as session:
            items = await point_semantic.pending(session, profile.signature)
        if not items:
            return 0
        try:
            vectors = await embed_texts(
                profile, [item.content for item in items]
            )
        except Exception:
            async with self.database.session() as session:
                await point_semantic.save_many(
                    session, items, profile.signature, [None] * len(items)
                )
            raise
        async with self.database.session() as session:
            await point_semantic.save_many(
                session, items, profile.signature, vectors
            )
        _logger.info(
            "point_index_batch_completed", "点位索引已更新", points=len(items)
        )
        return len(items)
