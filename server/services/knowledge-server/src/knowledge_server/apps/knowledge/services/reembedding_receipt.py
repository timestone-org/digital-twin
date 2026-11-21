"""在返回重嵌回执前提交，并由持久任务核对失去的应答。"""

import asyncio
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.crud import reembedding as jobs
from knowledge_server.apps.knowledge.reembedding_errors import (
    ReceiptUnconfirmed,
)
from knowledge_server.apps.knowledge.schemas.reembedding import (
    ReembeddingJobOut,
)
from lib.db import run_after_commit_hooks
from lib.logging import get_logger

type Sessions = Callable[[], AbstractAsyncContextManager[AsyncSession]]
CHECK_SECONDS = 5.0
_logger = get_logger("knowledge.reembedding")


async def _read_committed(
    session: AsyncSession, reopen: Sessions, expected: ReembeddingJobOut
) -> ReembeddingJobOut | None:
    """等待原事务释放库锁，再由独立连接读取其结果。

    Args: session, reopen, expected。
    """
    try:
        await session.rollback()
    except Exception as error:
        _logger.warning(
            "reembedding_connection_unavailable",
            "原事务连接不可用",
            reason=type(error).__name__,
        )
    async with reopen() as probe:
        if await jobs.lock_base(probe, expected.base_id) is None:
            return None
        row = await jobs.get_job(probe, expected.base_id, expected.id)
        return None if row is None else ReembeddingJobOut.model_validate(row)


async def commit_job(
    session: AsyncSession,
    reopen: Sessions,
    expected: ReembeddingJobOut,
    *,
    is_cancel: bool = False,
) -> ReembeddingJobOut:
    """确认任务和审计已经提交，再给出回执。

    Args: session, reopen, expected, is_cancel。
    """
    try:
        await session.commit()
    except Exception:
        try:
            async with asyncio.timeout(CHECK_SECONDS):
                observed = await _read_committed(session, reopen, expected)
        except Exception as error:
            raise ReceiptUnconfirmed(
                "暂时无法核实重嵌操作，请用原幂等键或任务地址核对结果"
            ) from error
        if observed is None or (
            is_cancel and observed.status != expected.status
        ):
            raise
        expected = observed
    await run_after_commit_hooks(session)
    return expected
