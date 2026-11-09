"""跨进程调用之前，把到此为止只读过的那段事务了结、连接还回池里。

⚠ 检索要穿插好几次模型、嵌入与重排调用，直传登记要读几十兆原件再挪件：事务开着
跨过去的话，连接在池里「事务中空闲」几十秒，几个并发请求就能把整个池子占满，连带
别的端点一起卡住（database-standard：事务里禁止外部 IO）。了结之后下一条 SQL 会
自己再开一个短事务。⚠ 只许用在**还没写过**的事务上。
"""

from sqlalchemy.ext.asyncio import AsyncSession


async def released(session: AsyncSession) -> None:
    """此刻开着事务就了结它。

    Args: session（只读过的那个会话）。
    """
    if session.in_transaction():
        await session.commit()
