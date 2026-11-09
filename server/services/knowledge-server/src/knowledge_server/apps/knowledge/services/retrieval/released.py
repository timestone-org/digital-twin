"""跨进程调用之前，把检索那一段只读事务了结、连接还回池里。

⚠ 检索全程只读，而它要穿插好几次模型、嵌入与重排调用：事务开着跨过去的话，
连接在池里「事务中空闲」几十秒，几个并发提问就能把整个池子占满，连带别的端点
一起卡住（database-standard：事务里禁止外部 IO）。了结之后下一条 SQL 会自己
再开一个短事务。
"""

from sqlalchemy.ext.asyncio import AsyncSession


async def released(session: AsyncSession) -> None:
    """此刻开着事务就了结它。

    Args: session（只读过的那个会话）。
    """
    if session.in_transaction():
        await session.commit()
