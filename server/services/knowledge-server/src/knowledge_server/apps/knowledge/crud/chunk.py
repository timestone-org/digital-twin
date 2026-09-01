"""块行的数据访问。只做查询与写入，**不提交**。"""

import uuid
from collections.abc import Sequence
from dataclasses import asdict
from typing import Any, cast

from sqlalchemy import delete, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.models import KnowledgeChunk
from knowledge_server.apps.knowledge.services.chunking import Chunk


async def replace_chunks(
    session: AsyncSession,
    base_id: uuid.UUID,
    document_id: uuid.UUID,
    chunks: Sequence[Chunk],
) -> list[uuid.UUID]:
    """整份文档的块**整体替换**，回新块的 id（按 ordinal）。

    ⚠ 先删再插而不是增量更新：重新解析之后块的边界会变，一一对应的更新要先
    算出「哪一块还是原来那一块」，而那件事本身就没有答案。整体替换的代价是
    向量要重算，收益是不会留下一批指着旧文字的块。

    ⚠ 块向量随外键级联删掉——所以调用方必须紧接着重新嵌入，不能只删不补。

    Args: session, base_id, document_id, chunks。
    """
    await session.execute(
        delete(KnowledgeChunk).where(KnowledgeChunk.document_id == document_id)
    )
    rows = [
        KnowledgeChunk(
            base_id=base_id,
            document_id=document_id,
            ordinal=one.ordinal,
            text=one.text,
            locator_json=asdict(one.locator),
            heading_path=one.heading_path,
            token_count=one.token_count,
        )
        for one in chunks
    ]
    session.add_all(rows)
    await session.flush()
    return [one.id for one in rows]


async def chunks_by_ids(
    session: AsyncSession, chunk_ids: Sequence[uuid.UUID]
) -> list[KnowledgeChunk]:
    """按 id 批量取块。

    ⚠ 回来的顺序**不保证**与入参一致：SQL 的 `IN` 不承诺顺序。调用方要按
    自己的排名重排——照单全收的话，检索结果的先后会变成数据库的物理顺序。

    Args: session, chunk_ids。
    """
    if not chunk_ids:
        return []
    found = await session.execute(
        select(KnowledgeChunk).where(KnowledgeChunk.id.in_(chunk_ids))
    )
    return list(found.scalars())


async def count_chunks(session: AsyncSession, base_id: uuid.UUID) -> int:
    """一个库里有多少块。

    Args: session, base_id。
    """
    found = await session.execute(
        select(func.count())
        .select_from(KnowledgeChunk)
        .where(KnowledgeChunk.base_id == base_id)
    )
    return int(found.scalar_one())


async def drop_chunks(session: AsyncSession, document_id: uuid.UUID) -> int:
    """删掉一份文档的全部块。块向量随外键级联。

    Args: session, document_id。
    """
    done = await session.execute(
        delete(KnowledgeChunk).where(KnowledgeChunk.document_id == document_id)
    )
    # cast 的理由 —— DML 的 execute 运行期返回 CursorResult，而 AsyncSession
    # 的静态签名只承诺 Result，`rowcount` 在后者上不存在
    return max(0, cast("CursorResult[Any]", done).rowcount)
