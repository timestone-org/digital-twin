"""认出一次完整性错误撞的是哪条约束，只有编码唯一约束才算「已占用」。"""

from sqlalchemy.exc import IntegrityError


def violates(error: IntegrityError, constraint: str) -> bool:
    """这次错误是不是撞了指定约束。

    ⚠ 约束名在驱动异常上，SQLAlchemy 的适配层把它挂在 `orig.__cause__`。
    Args: error, constraint。
    """
    cause = getattr(error.orig, "__cause__", None)
    return getattr(cause, "constraint_name", None) == constraint
