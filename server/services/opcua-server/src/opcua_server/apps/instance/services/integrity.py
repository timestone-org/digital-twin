"""把撞唯一约束翻成领域冲突，而不是让它冒成 500。

⚠ 「先查再插」在并发下必然漏：真正防重的是库里的唯一约束，这里只负责把它
说成调用方看得懂的 409（api-contract §4：HTTP 状态码必须真实）。
"""

from collections.abc import Callable, Mapping

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError

# 约束名 → 造冲突异常的工厂
ConflictMap = Mapping[str, Callable[[], AppError]]


def violated_constraint(error: IntegrityError) -> str | None:
    """这次完整性错误撞的是哪条约束；驱动没给就是 None。

    Args: error。
    """
    cause = getattr(error.orig, "__cause__", None)
    return getattr(cause, "constraint_name", None)


async def flush_or_conflict(
    session: AsyncSession, conflicts: ConflictMap
) -> None:
    """flush，撞到登记过的唯一约束就抛对应的领域冲突，其余原样抛。

    Args: session, conflicts。
    """
    try:
        await session.flush()
    except IntegrityError as error:
        make = conflicts.get(violated_constraint(error) or "")
        if make is None:
            raise
        raise make() from error
