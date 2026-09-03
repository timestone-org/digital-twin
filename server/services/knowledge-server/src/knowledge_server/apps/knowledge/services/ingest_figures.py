"""摄取管线里「存图」那一段：字节进对象存储、行进库、块与图连起来。

⚠ 单独一个模块而不是留在 `ingest_pipeline.py` 里：那份是**编排**（一段一段
推状态），这份是一件具体的活。合在一起之后那个模块过了 600 行，而真正的问题
不是行数——是编排里混进了「对象键长什么样」这种细节。

⚠ 抛自己的 `FigureStoreFailed` 而不是管线的 `IngestFailed`：反过来的话这份要
import 管线，而管线要 import 这份——一个环。由管线在调用点翻一次。
"""

import hashlib
import uuid
from collections.abc import Callable, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import replace

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.crud.figure import FigureWrite
from knowledge_server.apps.knowledge.services.chunking import Chunk
from knowledge_server.apps.knowledge.services.parsing import (
    Figure,
    ParsedDocument,
)
from knowledge_server.apps.knowledge.services.sources.keys import figure_key
from lib.objectstore import ObjectStore, ObjectStoreError

# media type → 对象键的后缀。⚠ 白名单：解析后端给的 media type 是外部数据，
# 拿它拼后缀等于让外部决定对象键的形状
_MEDIA_SUFFIXES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


# 开一个新事务的口子。⚠ 定义在这里而不是管线里：管线 import 这一份，
# 反过来会成环。收工厂而不是收一个会话——每一段要自己一个事务
Sessions = Callable[[], AbstractAsyncContextManager[AsyncSession]]


class FigureStoreFailed(RuntimeError):
    """图存不进去。由管线翻成「这份文档摄不进来」。"""


def hashed(content: bytes) -> str:
    """一张图的内容哈希。

    ⚠ 它同时是对象键的名字：同一张图重新解析算出同一个键，于是不必重传、
    桶里也不会留下一串孤儿。序号会随切分变化而漂，哈希不会。

    Args: content。
    """
    return hashlib.sha256(content).hexdigest()


def _suffix_of(media_type: str) -> str:
    """按 media type 给一个能进对象键的后缀。

    ⚠ 认不出给 `.bin` 而不是空串：桶里那一堆无后缀对象在运维手里就是一团
    看不出是什么的东西。

    Args: media_type。
    """
    return _MEDIA_SUFFIXES.get(media_type, ".bin")


def _bbox_of(one: Figure) -> dict[str, int]:
    """版面框摊成 JSONB；拿不到就空对象。

    Args: one。
    """
    if one.bbox is None:
        return {}
    left, top, right, bottom = one.bbox
    return {"x0": left, "y0": top, "x1": right, "y1": bottom}


async def _put_one(
    store: ObjectStore,
    base_id: uuid.UUID,
    document_id: uuid.UUID,
    numbered: tuple[int, Figure],
) -> FigureWrite:
    """一张图放上去并摊成要落的那一行。

    ⚠ 存不上就整份判失败，不「少存一张继续走」：少了的那张在引用面上是一个
    取不到的图，而那与「这一段本来没有图」看起来一模一样。

    Args: store, base_id, document_id, numbered（序号与那张图）。
    """
    at, one = numbered
    digest = hashed(one.content)
    key = figure_key(base_id, document_id, digest, _suffix_of(one.media_type))
    try:
        await store.put_bytes(key, one.content, content_type=one.media_type)
    except ObjectStoreError as error:
        raise FigureStoreFailed(f"图存不进对象存储：{error}") from error
    return FigureWrite(
        ordinal=at,
        kind=one.kind,
        page=one.page,
        caption=one.caption,
        object_key=key,
        media_type=one.media_type,
        byte_size=len(one.content),
        content_hash=digest,
        bbox=_bbox_of(one),
    )


def _deduped(rows: list[FigureWrite]) -> list[FigureWrite]:
    """同一份文档里同一张图只留一行，序号重新排。

    ⚠ 不去重会撞 `(document_id, content_hash)` 那条唯一键：每页都有的图框会被
    解析出很多份，而那一撞会让整份文档摄取失败。

    Args: rows。
    """
    seen: set[str] = set()
    made: list[FigureWrite] = []
    for one in rows:
        if one.content_hash in seen:
            continue
        seen.add(one.content_hash)
        made.append(replace(one, ordinal=len(made)))
    return made


async def store_figures(
    sessions: Sessions,
    store: ObjectStore,
    where: tuple[uuid.UUID, uuid.UUID],
    parsed: ParsedDocument,
) -> dict[str, uuid.UUID]:
    """把解析出来的图落进对象存储与库，回「`Figure.ref` → 图 id」。

    ⚠ 放字节在事务**之外**、落行在事务之内：放字节是一次外部 IO，包在事务里
    会让一次对象存储超时把数据库连接占住几十秒。

    Args: sessions（开事务的口子）, store, where（库 id 与文档 id）, parsed。
    """
    base_id, document_id = where
    if not parsed.figures:
        return {}
    rows: list[FigureWrite] = []
    by_ref: dict[str, str] = {}
    for at, one in enumerate(parsed.figures):
        by_ref[one.ref] = hashed(one.content)
        rows.append(await _put_one(store, base_id, document_id, (at, one)))
    async with sessions() as session:
        made = await crud.figure.replace_figures(
            session, base_id, document_id, _deduped(rows)
        )
    return {
        ref: made[digest] for ref, digest in by_ref.items() if digest in made
    }


def links_of(
    chunks: Sequence[Chunk],
    chunk_ids: Sequence[uuid.UUID],
    figure_ids: dict[str, uuid.UUID],
) -> list[tuple[uuid.UUID, uuid.UUID, int]]:
    """块与图的联结行。

    ⚠ 认不出的 ref 直接跳过而不是抛：解析后端可能给了一个没有对应字节的引用，
    而为它整份判失败会把一份好文档挡在外面。

    Args: chunks, chunk_ids, figure_ids。
    """
    made: list[tuple[uuid.UUID, uuid.UUID, int]] = []
    for chunk, chunk_id in zip(chunks, chunk_ids, strict=True):
        at = 0
        for ref in chunk.figure_refs:
            figure_id = figure_ids.get(ref)
            if figure_id is None:
                continue
            made.append((chunk_id, figure_id, at))
            at += 1
    return made
