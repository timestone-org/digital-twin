"""把召回的块 id 补成带出处的 `Hit`。

⚠ 顺序**按打分的名次重排**，不照单全收数据库回来的顺序：SQL 的 `IN` 不承诺
顺序，照单全收的话检索结果的先后会变成数据库的物理顺序——而那时排序看着
「有点随机」，谁也说不清是哪一层错了。
"""

import uuid
from collections.abc import Sequence
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.models import KnowledgeDocument
from knowledge_server.apps.knowledge.services.parsing import Locator
from knowledge_server.apps.knowledge.services.retrieval.ports import (
    Fused,
    Hit,
)


def _locator(raw: dict[str, Any]) -> Locator:
    """把落库的那袋 JSON 还原成定位。

    ⚠ 逐格取而不是 `Locator(**raw)`：库里可能存着旧版本写下的多余键，
    而 `**` 展开会当场抛——一条读不出来的旧记录不该让整次检索失败。

    Args: raw。
    """
    path = cast("list[object]", raw.get("path") or [])
    return Locator(
        page=_as_int(raw.get("page")),
        sheet=str(raw.get("sheet") or ""),
        row=_as_int(raw.get("row")),
        path=tuple(str(one) for one in path),
    )


def _as_int(given: object) -> int | None:
    """一格页码 / 行号；不是整数就当没有。

    ⚠ 不抛：库里可能存着旧版本写下的字符串，而一条读不出来的旧记录不该让
    整次检索失败——它只该少一格出处。

    Args: given。
    """
    return given if isinstance(given, int) else None


async def hydrated(
    session: AsyncSession, ranked: Sequence[Fused], limit: int
) -> tuple[Hit, ...]:
    """按名次把前几条补成带出处的召回。

    Args: session, ranked（已按分数降序）, limit。
    """
    wanted = list(ranked)[:limit]
    rows = await crud.chunk.chunks_by_ids(
        session, [one.chunk_id for one in wanted]
    )
    by_id = {row.id: row for row in rows}
    titles = await _titles(session, {row.document_id for row in rows})
    made: list[Hit] = []
    for one in wanted:
        row = by_id.get(one.chunk_id)
        if row is None:
            continue
        made.append(
            Hit(
                chunk_id=row.id,
                document_id=row.document_id,
                document_title=titles.get(row.document_id, ""),
                text=row.text,
                heading_path=row.heading_path,
                locator=_locator(row.locator_json),
                score=one.score,
                why="；".join(one.reasons),
            )
        )
    return tuple(made)


async def _titles(
    session: AsyncSession, document_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """一批文档的标题。

    ⚠ 一次取回来而不是每条召回查一次：十条召回就是十次往返，而它只表现为
    「检索有点慢」。

    Args: session, document_ids。
    """
    if not document_ids:
        return {}
    found = await session.execute(
        select(KnowledgeDocument.id, KnowledgeDocument.title).where(
            KnowledgeDocument.id.in_(document_ids)
        )
    )
    return {row[0]: row[1] for row in found.all()}
