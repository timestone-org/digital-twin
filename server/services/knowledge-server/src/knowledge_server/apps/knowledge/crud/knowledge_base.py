"""知识库行的数据访问。只做查询与写入，**不提交**——事务边界归 service 层。"""

import uuid
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import delete, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.models import KnowledgeBase


@dataclass(frozen=True)
class BaseWrite:
    """建一个库要的那几样。

    ⚠ 打成一包不是为了好看：函数的形参上限是 5，而一个库天然需要
    「叫什么、说明、谁建的、嵌入档、维数、走哪个策略」六件事。
    """

    name: str
    description: str
    owner_id: str
    embedding_model: str | None
    dimensions: int | None
    retrieval_strategy: str


async def insert_base(session: AsyncSession, write: BaseWrite) -> KnowledgeBase:
    """落一行库并 flush 拿 id。

    ⚠ 用 flush 不用 commit：提前 commit 会把这一步与后面的动作拆成两个事务，
    而中间失败时库已经建出来了、别的没建。

    Args: session, write。
    """
    row = KnowledgeBase(
        name=write.name,
        description=write.description,
        owner_id=write.owner_id,
        embedding_model=write.embedding_model,
        dimensions=write.dimensions,
        retrieval_strategy=write.retrieval_strategy,
    )
    session.add(row)
    await session.flush()
    return row


async def get_base(
    session: AsyncSession, base_id: uuid.UUID
) -> KnowledgeBase | None:
    """按 id 取一个库；没有给 `None`。

    Args: session, base_id。
    """
    found = await session.execute(
        select(KnowledgeBase).where(KnowledgeBase.id == base_id)
    )
    return found.scalar_one_or_none()


async def list_bases(
    session: AsyncSession, *, offset: int, limit: int
) -> tuple[list[KnowledgeBase], int]:
    """列一页库与总数。

    Args: session, offset, limit。
    """
    rows = await session.execute(
        select(KnowledgeBase)
        .order_by(KnowledgeBase.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    total = await session.execute(
        select(func.count()).select_from(KnowledgeBase)
    )
    return (list(rows.scalars()), int(total.scalar_one()))


async def delete_base(session: AsyncSession, base_id: uuid.UUID) -> int:
    """删一个库。来源、文档、块、块向量随外键级联。

    ⚠ 对象存储里的原件**不由这里删**：那是一次外部 IO，而事务里禁做外部 IO。
    由 service 层在提交之后清（清失败只留下一堆没人引用的字节，不影响正确性）。

    Args: session, base_id。
    """
    done = await session.execute(
        delete(KnowledgeBase).where(KnowledgeBase.id == base_id)
    )
    # cast 的理由 —— DML 的 execute 运行期返回 CursorResult，而 AsyncSession
    # 的静态签名只承诺 Result，`rowcount` 在后者上不存在
    return max(0, cast("CursorResult[Any]", done).rowcount)
