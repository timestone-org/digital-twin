"""来源行的数据访问。只做查询与写入，**不提交**。"""

import uuid
from datetime import datetime
from typing import Any, cast

from sqlalchemy import delete, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.models import KnowledgeSource


async def insert_source(
    session: AsyncSession,
    base_id: uuid.UUID,
    kind: str,
    name: str,
    config: dict[str, Any],
) -> KnowledgeSource:
    """落一行来源并 flush 拿 id。

    Args: session, base_id, kind, name, config。
    """
    row = KnowledgeSource(
        base_id=base_id, kind=kind, name=name, config_json=config
    )
    session.add(row)
    await session.flush()
    return row


async def get_source(
    session: AsyncSession, source_id: uuid.UUID
) -> KnowledgeSource | None:
    """按 id 取一路来源。

    Args: session, source_id。
    """
    found = await session.execute(
        select(KnowledgeSource).where(KnowledgeSource.id == source_id)
    )
    return found.scalar_one_or_none()


async def list_sources(
    session: AsyncSession, base_id: uuid.UUID
) -> list[KnowledgeSource]:
    """一个库下的全部来源。

    ⚠ 不分页：一个库下的来源是**个位数**，分页只会让调用方多写一段翻页而
    永远翻不到第二页。

    Args: session, base_id。
    """
    rows = await session.execute(
        select(KnowledgeSource)
        .where(KnowledgeSource.base_id == base_id)
        .order_by(KnowledgeSource.created_at)
    )
    return list(rows.scalars())


async def find_source_by_kind(
    session: AsyncSession, base_id: uuid.UUID, kind: str
) -> KnowledgeSource | None:
    """一个库下某一路来源的第一行；没有给 `None`。

    ⚠ 上传那一路每个库只该有一行——建库时自动建出来，之后复用。

    Args: session, base_id, kind。
    """
    found = await session.execute(
        select(KnowledgeSource)
        .where(KnowledgeSource.base_id == base_id)
        .where(KnowledgeSource.kind == kind)
        .order_by(KnowledgeSource.created_at)
        .limit(1)
    )
    return found.scalar_one_or_none()


async def delete_source(session: AsyncSession, source_id: uuid.UUID) -> int:
    """删一路来源。它名下的文档随外键级联。

    Args: session, source_id。
    """
    done = await session.execute(
        delete(KnowledgeSource).where(KnowledgeSource.id == source_id)
    )
    # cast 的理由 —— DML 的 execute 运行期返回 CursorResult，而 AsyncSession
    # 的静态签名只承诺 Result，`rowcount` 在后者上不存在
    return max(0, cast("CursorResult[Any]", done).rowcount)


async def mark_synced(
    session: AsyncSession,
    source_id: uuid.UUID,
    cursor: str | None,
    when: datetime,
) -> int:
    """记下这一路同步到哪了。

    ⚠ 顺手把 `last_error` 清空：这一次成功了，上一次的失败原因留着会让界面上
    「刚同步过」与「一直在报错」同时成立。

    Args: session, source_id, cursor, when。
    """
    done = await session.execute(
        update(KnowledgeSource)
        .where(KnowledgeSource.id == source_id)
        .values(sync_cursor=cursor, last_synced_at=when, last_error="")
    )
    # cast 的理由 —— DML 的 execute 运行期返回 CursorResult，而 AsyncSession
    # 的静态签名只承诺 Result，`rowcount` 在后者上不存在
    return max(0, cast("CursorResult[Any]", done).rowcount)


async def mark_sync_failed(
    session: AsyncSession, source_id: uuid.UUID, reason: str
) -> int:
    """记下这一路同步失败了。

    ⚠ **不动游标**：失败时把游标清掉会让下一次从头再来，而那意味着把已经摄过
    的每一条都重新拉一遍。

    Args: session, source_id, reason。
    """
    done = await session.execute(
        update(KnowledgeSource)
        .where(KnowledgeSource.id == source_id)
        .values(last_error=reason)
    )
    return max(0, cast("CursorResult[Any]", done).rowcount)
