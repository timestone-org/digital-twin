"""用例那条回滚事务上的会话工厂，与把它包成「开短事务」的最小面。

⚠ 与 HTTP 那侧必须共用同一条连接：分开连就是两个事务，用例经接口种下的数据在
另一侧根本看不见，而现象是「查不到」，看着像业务逻辑写错了。
"""

import contextlib
from collections.abc import AsyncIterator
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
)

from lib.db import run_after_commit_hooks


def rollback_sessions(
    connection: AsyncConnection,
) -> async_sessionmaker[AsyncSession]:
    """一条回滚事务上的会话工厂。

    ⚠ `join_transaction_mode="create_savepoint"`：请求内的 commit 只落到保存点，
    外层事务最后整体回滚，跨请求可见但不留痕。
    Args: connection。
    """
    return async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )


@dataclass(frozen=True)
class MakerSessions:
    """把用例那条回滚事务的会话工厂包成「开短事务」的最小面。

    ⚠ 必须与 HTTP 那侧共用同一条连接：分开连就是两个事务，用例经接口种下的
    绑定在下发那边根本看不见，而现象是「模型不存在」，看着像业务逻辑写错了。
    工厂本身用的是 `join_transaction_mode="create_savepoint"`，故这里的提交
    只落到保存点，外层事务最后整体回滚。
    """

    maker: async_sessionmaker[AsyncSession]

    @contextlib.asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        """开一个落在保存点上的短事务。"""
        async with self.maker() as opened:
            try:
                yield opened
            except Exception:
                await opened.rollback()
                raise
            else:
                await opened.commit()
                await run_after_commit_hooks(opened)
