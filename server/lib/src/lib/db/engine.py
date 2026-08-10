"""异步引擎与会话工厂。事务边界由 service 层持有，crud 层不提交。"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from lib.logging.logger import get_logger

_logger = get_logger("lib.db")


class Database:
    """持有引擎与会话工厂。进程内单例，但只是无状态的连接池句柄。"""

    def __init__(
        self,
        *,
        dsn: str,
        pool_size: int = 10,
        max_overflow: int = 5,
        connect_timeout_s: float = 5.0,
        statement_timeout_ms: int = 2000,
        lock_timeout_ms: int = 3000,
        search_path: str | None = None,
    ) -> None:
        server_settings = {
            "statement_timeout": str(statement_timeout_ms),
            "lock_timeout": str(lock_timeout_ms),
        }
        if search_path is not None:
            server_settings["search_path"] = search_path
        self._engine: AsyncEngine = create_async_engine(
            dsn,
            pool_size=pool_size,
            max_overflow=max_overflow,
            pool_pre_ping=True,
            connect_args={
                "timeout": connect_timeout_s,
                "server_settings": server_settings,
            },
        )
        self._sessions = async_sessionmaker(
            self._engine, expire_on_commit=False, class_=AsyncSession
        )

    @property
    def engine(self) -> AsyncEngine:
        return self._engine

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession]:
        """一次逻辑操作一个事务：正常出块提交，异常回滚。"""
        async with self._sessions() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
            else:
                await session.commit()

    async def ping(self) -> bool:
        """连通性自检，供启动自检与就绪探针复用。"""
        try:
            async with self._engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        except Exception as error:
            _logger.warning("db_ping_failed", "数据库不可达", error=error)
            return False
        return True

    async def dispose(self) -> None:
        """关闭连接池。关停序列的最后一步。"""
        await self._engine.dispose()
