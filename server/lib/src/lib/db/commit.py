"""在发布可重放的回执前确认数据库事务。"""

from sqlalchemy.exc import DBAPIError, PendingRollbackError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db.hooks import run_after_commit_hooks
from lib.errors import DependencyUnavailable

_CONFIRMED_ROLLBACK = frozenset({"40000", "40001", "40002", "40P01"})


class CommitOutcomeUnknown(DependencyUnavailable):
    """提交应答丢失，数据库可能已保存此次操作。"""

    is_outcome_unknown = True
    is_retryable = False


def _aborted(error: Exception) -> bool:
    """判断数据库是否明确报告事务未提交。Args: error。"""
    if isinstance(error, PendingRollbackError):
        return True
    if not isinstance(error, DBAPIError) or error.connection_invalidated:
        return False
    state = getattr(error.orig, "sqlstate", None)
    return isinstance(state, str) and (
        state.startswith("23") or state in _CONFIRMED_ROLLBACK
    )


async def commit_before_receipt(session: AsyncSession) -> None:
    """确认提交并执行提交后回调，再允许写入幂等回执。Args: session。"""
    try:
        await session.commit()
    except Exception as error:
        if _aborted(error):
            raise
        raise CommitOutcomeUnknown(
            "数据库提交结果未确认，请先核对操作结果"
        ) from error
    await run_after_commit_hooks(session)
