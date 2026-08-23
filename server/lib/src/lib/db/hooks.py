"""提交后副作用的登记表：事务落了地才去通知别人。

⚠ 就地做这些事是错的：提交还没落，被通知的一方读到的仍是旧数据，而它多半
不会再读第二次——报脏、发通知、失效缓存都属这一类（database-standard §6）。
⚠ 要强一致的东西不许走这里：钩子跑在事务已经不可回滚之后，丢了就是丢了，
那种需求得用事务内的补偿表。
"""

from collections.abc import Awaitable, Callable
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging.logger import get_logger

_logger = get_logger("lib.db")

# 登记表挂在 `session.info` 上的键
_HOOKS_KEY = "after_commit_hooks"

#: 一个提交后副作用。无参无返回：要用的东西在登记时闭包进去
AfterCommitHook = Callable[[], Awaitable[None]]


def after_commit(session: AsyncSession, hook: AfterCommitHook) -> None:
    """登记一个「本次事务提交成功后」才跑的副作用。

    Args: session, hook。
    """
    hooks = cast(
        "list[AfterCommitHook]", session.info.setdefault(_HOOKS_KEY, [])
    )
    hooks.append(hook)


async def run_after_commit_hooks(session: AsyncSession) -> None:
    """跑完并清空这个会话的登记表。

    ⚠ 单个钩子抛错只记一条日志就接着跑下一个：数据已经落库了，为了一条通知
    把一次成功的写入变成 500，是拿已经成功的事去赌一件本来就有兜底的事。
    ⚠ 登记表先取出再执行：钩子里再登记的东西属于下一个事务，不该在本轮跑掉。
    Args: session。
    """
    hooks = cast("list[AfterCommitHook]", session.info.pop(_HOOKS_KEY, []))
    for hook in hooks:
        try:
            await hook()
        except Exception as error:
            _logger.warning(
                "after_commit_hook_failed",
                "提交后副作用未执行完",
                error_type=type(error).__name__,
            )
