"""文档行的数据访问。只做查询与写入，**不提交**。"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

from sqlalchemy import Select, delete, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.models import KnowledgeDocument


@dataclass(frozen=True)
class DocumentWrite:
    """登记一份文档要的那几样。"""

    document_id: uuid.UUID
    base_id: uuid.UUID
    source_id: uuid.UUID
    external_ref: str
    title: str
    media_type: str
    object_key: str
    byte_size: int
    content_hash: str
    ingest_generation: uuid.UUID | None = None


async def insert_document(session: AsyncSession, write: DocumentWrite) -> None:
    """落一行文档。

    ⚠ 撞 `(base_id, content_hash)` 唯一键时**让它抛**，由 service 层翻成
    「这份内容已经在库里了」。悄悄忽略的话，用户以为传成功了，而界面上
    永远等不到那份新文档——它压根没有新的一行。

    Args: session, write。
    """
    session.add(
        KnowledgeDocument(
            id=write.document_id,
            base_id=write.base_id,
            source_id=write.source_id,
            external_ref=write.external_ref,
            title=write.title,
            media_type=write.media_type,
            object_key=write.object_key,
            byte_size=write.byte_size,
            content_hash=write.content_hash,
            ingest_generation=write.ingest_generation,
        )
    )
    await session.flush()


async def get_document(
    session: AsyncSession, document_id: uuid.UUID
) -> KnowledgeDocument | None:
    """按 id 取一份文档。

    Args: session, document_id。
    """
    found = await session.execute(
        select(KnowledgeDocument).where(KnowledgeDocument.id == document_id)
    )
    return found.scalar_one_or_none()


def _filtered(
    base_id: uuid.UUID, status: str
) -> Select[tuple[KnowledgeDocument]]:
    query = select(KnowledgeDocument).where(
        KnowledgeDocument.base_id == base_id
    )
    return (
        query if not status else query.where(KnowledgeDocument.status == status)
    )


async def counts_by_base(
    session: AsyncSession, base_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """这几个库各有几份文档。

    ⚠ 一次查完再按库分组，**不逐个库查**：库清单一页十来个，逐个查就是十来个
    往返，而这一格只是列表上的一行字。

    ⚠ 一份文档都没有的库**不在回表里**：调用方拿 0 兜底。让 SQL 去补零要多
    一次外连接，而调用方本来就得处理「这个库不在表里」。

    Args: session, base_ids。
    """
    if not base_ids:
        return {}
    rows = await session.execute(
        select(KnowledgeDocument.base_id, func.count())
        .where(KnowledgeDocument.base_id.in_(base_ids))
        .group_by(KnowledgeDocument.base_id)
    )
    return {base_id: int(count) for base_id, count in rows.all()}


async def list_documents(
    session: AsyncSession,
    base_id: uuid.UUID,
    status: str,
    window: tuple[int, int],
) -> tuple[list[KnowledgeDocument], int]:
    """列一页文档与总数。

    Args: session, base_id, status（空串即不筛）, window（offset, limit）。
    """
    offset, limit = window
    rows = await session.execute(
        _filtered(base_id, status)
        .order_by(KnowledgeDocument.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    total = await session.execute(
        select(func.count()).select_from(_filtered(base_id, status).subquery())
    )
    return (list(rows.scalars()), int(total.scalar_one()))


async def mark_status(
    session: AsyncSession,
    document_id: uuid.UUID,
    status: str,
    reason: str = "",
) -> int:
    """把一份文档推到下一个状态。

    ⚠ 回的是**改动行数**，调用方要看它：0 说明这一行已经不在了（被人删了），
    而那时接着往下走会把块写进一个没有属主的文档里。

    Args: session, document_id, status, reason（失败原因，成功时空串）。
    """
    done = await session.execute(
        update(KnowledgeDocument)
        .where(KnowledgeDocument.id == document_id)
        .values(status=status, failure_reason=reason)
    )
    # cast 的理由 —— DML 的 execute 运行期返回 CursorResult，而 AsyncSession
    # 的静态签名只承诺 Result，`rowcount` 在后者上不存在
    return max(0, cast("CursorResult[Any]", done).rowcount)


async def claim_ingest(
    session: AsyncSession,
    document_id: uuid.UUID,
    generation: uuid.UUID | None,
) -> KnowledgeDocument | None:
    """原子认领当前 generation 的非终态文档并推进 parsing。

    Args: session, document_id, generation（None 只兼容存量 v1 消息）。
    """
    statement = (
        update(KnowledgeDocument)
        .where(
            KnowledgeDocument.id == document_id,
            KnowledgeDocument.status.not_in(("ready", "failed")),
        )
        .values(status="parsing", failure_reason="")
        .returning(KnowledgeDocument)
    )
    if generation is None:
        statement = statement.where(
            KnowledgeDocument.ingest_generation.is_(None)
        )
    else:
        statement = statement.where(
            KnowledgeDocument.ingest_generation == generation
        )
    found = await session.execute(statement)
    return found.scalar_one_or_none()


async def mark_requeued(
    session: AsyncSession,
    document_id: uuid.UUID,
    generation: uuid.UUID | None,
) -> int:
    """仅待投递或终态可开启新 generation；处理中不被旧请求打断。

    Args: session, document_id, generation。
    """
    done = await session.execute(
        update(KnowledgeDocument)
        .where(
            KnowledgeDocument.id == document_id,
            KnowledgeDocument.status.in_(("pending", "ready", "failed")),
        )
        .values(
            status="pending",
            failure_reason="",
            ready_at=None,
            ingest_generation=generation,
        )
    )
    return max(0, cast("CursorResult[Any]", done).rowcount)


async def mark_ready(
    session: AsyncSession,
    document_id: uuid.UUID,
    chunk_count: int,
    ready_at: datetime,
) -> int:
    """收尾：置 ready 并记下切了几块。

    Args: session, document_id, chunk_count, ready_at。
    """
    done = await session.execute(
        update(KnowledgeDocument)
        .where(KnowledgeDocument.id == document_id)
        .values(
            status="ready",
            failure_reason="",
            chunk_count=chunk_count,
            ready_at=ready_at,
        )
    )
    # cast 的理由 —— DML 的 execute 运行期返回 CursorResult，而 AsyncSession
    # 的静态签名只承诺 Result，`rowcount` 在后者上不存在
    return max(0, cast("CursorResult[Any]", done).rowcount)


async def delete_document(session: AsyncSession, document_id: uuid.UUID) -> int:
    """删一份文档。它的块与块向量随外键级联。

    Args: session, document_id。
    """
    done = await session.execute(
        delete(KnowledgeDocument).where(KnowledgeDocument.id == document_id)
    )
    # cast 的理由 —— DML 的 execute 运行期返回 CursorResult，而 AsyncSession
    # 的静态签名只承诺 Result，`rowcount` 在后者上不存在
    return max(0, cast("CursorResult[Any]", done).rowcount)
