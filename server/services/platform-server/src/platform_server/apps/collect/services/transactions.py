"""跨进程调用之前把只读事务放掉。

⚠ **事务里禁止外部 IO**（database-standard §6）：命令总线要往返一趟现场设备，
握着数据库连接等它，等于把连接与锁一起长期占住。而工控网的往返是秒级的。
"""

from sqlalchemy.ext.asyncio import AsyncSession


async def release_read_transaction(session: AsyncSession) -> None:
    """结束当前这个**只读**事务，让连接回到空闲。

    ⚠ 用 rollback 不用 commit：调用点之前只读过，没有任何要保留的写。用
    commit 会让「这里其实写过东西」这类错误静默落库。
    Args: session。
    """
    await session.rollback()
