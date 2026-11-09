"""先查后插之外的那道兜底：并发创建撞唯一约束时报业务冲突，而不是 500。"""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError


async def flush_unique(
    session: AsyncSession, *, constraint: str, taken: AppError
) -> None:
    """flush；撞上指定唯一约束就抛 `taken`，别的完整性错误原样抛。

    ⚠ 先查后插挡不住两个同时到的请求：后到的那个只会在这里撞约束。
    Args: session, constraint（约束名）, taken（要报的冲突）。
    """
    try:
        await session.flush()
    except IntegrityError as error:
        cause = getattr(error.orig, "__cause__", None)
        if getattr(cause, "constraint_name", None) != constraint:
            raise
        raise taken from error
