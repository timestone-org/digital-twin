"""解析出来的图落库与取回，打真库。

⚠ 这几条只能打真库：唯一键 `(document_id, content_hash)` 的去重、联结行随外键
级联、以及「只按图 id 取不到别的文档的图」都是数据库那一侧的行为，假件证明
不了。
"""

import uuid
from collections.abc import Callable
from typing import Any

import pytest

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.crud.figure import FigureWrite
from knowledge_server.apps.knowledge.models import (
    KnowledgeChunk,
    KnowledgeDocument,
)

pytestmark = pytest.mark.requires_postgres

HASH_A = "a" * 64
HASH_B = "b" * 64


def _write(ordinal: int, digest: str, page: int | None = 1) -> FigureWrite:
    return FigureWrite(
        ordinal=ordinal,
        kind="image",
        page=page,
        caption=f"图 {ordinal}",
        object_key=f"knowledge/x/y/figures/{digest}.jpg",
        media_type="image/jpeg",
        byte_size=1024,
        content_hash=digest,
        bbox={"x0": 1, "y0": 2, "x1": 3, "y1": 4},
    )


async def _seeded(
    sessions: Callable[[], Any],
) -> tuple[uuid.UUID, uuid.UUID, list[uuid.UUID]]:
    """建一个库、一份文档、两块，回它们的 id。"""
    async with sessions() as session:
        base = await crud.knowledge_base.insert_base(
            session,
            crud.knowledge_base.BaseWrite(
                name=f"图测试 {uuid.uuid4().hex[:6]}",
                description="",
                owner_id="tester",
                embedding_model=None,
                dimensions=None,
                retrieval_strategy="hybrid",
            ),
        )
        source = await crud.source.insert_source(
            session, base.id, "upload", "上传", {}
        )
        document = KnowledgeDocument(
            base_id=base.id,
            source_id=source.id,
            external_ref="knowledge/x/y.pdf",
            title="图测试.pdf",
            content_hash="c" * 64,
        )
        session.add(document)
        await session.flush()
        chunks = [
            KnowledgeChunk(
                base_id=base.id,
                document_id=document.id,
                ordinal=at,
                text=f"第 {at} 块",
            )
            for at in range(2)
        ]
        session.add_all(chunks)
        await session.flush()
        return (base.id, document.id, [one.id for one in chunks])


async def test_figures_land_and_come_back_keyed_by_content_hash(
    db_sessions: Callable[[], Any],
) -> None:
    base_id, document_id, _chunks = await _seeded(db_sessions)
    async with db_sessions() as session:
        made = await crud.figure.replace_figures(
            session,
            base_id,
            document_id,
            [_write(0, HASH_A), _write(1, HASH_B)],
        )
    assert set(made) == {HASH_A, HASH_B}
    async with db_sessions() as session:
        rows = await crud.figure.figures_of_document(session, document_id)
    assert [one.ordinal for one in rows] == [0, 1]
    assert rows[0].bbox_json == {"x0": 1, "y0": 2, "x1": 3, "y1": 4}


async def test_replacing_figures_drops_the_old_links(
    db_sessions: Callable[[], Any],
) -> None:
    """⚠ 联结行随外键级联删掉，所以重新解析必须紧接着重建它们——只删不补的
    表现是「引用面上突然一张图都没有了」。"""
    base_id, document_id, chunks = await _seeded(db_sessions)
    async with db_sessions() as session:
        made = await crud.figure.replace_figures(
            session, base_id, document_id, [_write(0, HASH_A)]
        )
        await crud.figure.link_figures(session, [(chunks[0], made[HASH_A], 0)])
    async with db_sessions() as session:
        found = await crud.figure.figures_of_chunks(session, [chunks[0]])
    assert len(found[chunks[0]]) == 1
    async with db_sessions() as session:
        await crud.figure.replace_figures(
            session, base_id, document_id, [_write(0, HASH_B)]
        )
    async with db_sessions() as session:
        found = await crud.figure.figures_of_chunks(session, chunks)
    assert found == {}


async def test_one_query_covers_every_chunk(
    db_sessions: Callable[[], Any],
) -> None:
    """⚠ 一次查完再按块分组，不逐块查：引用面一次要摊十来块，
    逐块查就是十来个往返。"""
    base_id, document_id, chunks = await _seeded(db_sessions)
    async with db_sessions() as session:
        made = await crud.figure.replace_figures(
            session,
            base_id,
            document_id,
            [_write(0, HASH_A), _write(1, HASH_B)],
        )
        await crud.figure.link_figures(
            session,
            [
                (chunks[0], made[HASH_A], 0),
                (chunks[1], made[HASH_A], 0),
                (chunks[1], made[HASH_B], 1),
            ],
        )
    async with db_sessions() as session:
        found = await crud.figure.figures_of_chunks(session, chunks)
    assert len(found[chunks[0]]) == 1
    assert [one.content_hash for one in found[chunks[1]]] == [HASH_A, HASH_B]


async def test_a_figure_cannot_be_read_through_another_document(
    db_sessions: Callable[[], Any],
) -> None:
    """⚠ 只按图 id 取的话，换一个文档 id 就能把别的库的图取出来——而那两个
    id 单看都是合法的 uuid。"""
    base_id, document_id, _chunks = await _seeded(db_sessions)
    _base2, other_document, _c2 = await _seeded(db_sessions)
    async with db_sessions() as session:
        made = await crud.figure.replace_figures(
            session, base_id, document_id, [_write(0, HASH_A)]
        )
    async with db_sessions() as session:
        assert (
            await crud.figure.get_figure(session, document_id, made[HASH_A])
            is not None
        )
        assert (
            await crud.figure.get_figure(session, other_document, made[HASH_A])
            is None
        )


async def test_deleting_the_document_takes_its_figures(
    db_sessions: Callable[[], Any],
) -> None:
    base_id, document_id, _chunks = await _seeded(db_sessions)
    async with db_sessions() as session:
        await crud.figure.replace_figures(
            session, base_id, document_id, [_write(0, HASH_A)]
        )
    async with db_sessions() as session:
        row = await session.get(KnowledgeDocument, document_id)
        assert row is not None
        await session.delete(row)
    async with db_sessions() as session:
        assert await crud.figure.figures_of_document(session, document_id) == []
