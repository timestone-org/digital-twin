"""PostgreSQL 会话测试设施。"""

from collections.abc import AsyncGenerator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

type SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]


def deferred_commit_failure(open_session: SessionFactory) -> SessionFactory:
    """生成写入可执行、在提交时因延迟唯一约束失败的会话。Args: open_session。"""

    @asynccontextmanager
    async def session() -> AsyncGenerator[AsyncSession]:
        async with open_session() as db:
            await db.execute(
                text(
                    "CREATE TEMP TABLE qa_deferred_unique "
                    "(n int UNIQUE DEFERRABLE INITIALLY DEFERRED) "
                    "ON COMMIT DROP"
                )
            )
            await db.execute(
                text("INSERT INTO qa_deferred_unique VALUES (1),(1)")
            )
            yield db

    return session
