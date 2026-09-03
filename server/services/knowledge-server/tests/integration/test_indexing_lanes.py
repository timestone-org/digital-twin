"""两路索引各自的读写，打真库（ADR-0045）。

⚠ 只有真库能验这两路：向量那一路的 `vector` 列与 HNSW、关键词那一路的
trigram，全是数据库那一侧的东西。假件测出来的是「我写的 SQL 长什么样」。
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.services.chunking import Chunk
from knowledge_server.apps.knowledge.services.indexing import (
    KeywordQuery,
    PgVectorIndex,
    TrgmKeywordIndex,
    VectorDimensionMismatch,
    VectorQuery,
    VectorRows,
)
from knowledge_server.apps.knowledge.services.parsing import Locator
from knowledge_server.apps.knowledge.services.sources import UPLOAD_KIND

pytestmark = pytest.mark.requires_postgres


def _vector(dimensions: int, *head: float) -> list[float]:
    """一条宽度正好的假向量：前几格给定，其余补 0。

    Args: dimensions, head。
    """
    return (list(head) + [0.0] * dimensions)[:dimensions]


async def _seeded_document(
    session: AsyncSession, base_id: uuid.UUID
) -> uuid.UUID:
    """给这个库落一路来源与一份文档，回文档 id。

    Args: session, base_id。
    """
    source = await crud.source.insert_source(
        session, base_id, UPLOAD_KIND, "上传", {}
    )
    document_id = uuid.uuid4()
    await crud.document.insert_document(
        session,
        crud.document.DocumentWrite(
            document_id=document_id,
            base_id=base_id,
            source_id=source.id,
            external_ref="a.md",
            title="a.md",
            media_type="",
            object_key="k",
            byte_size=1,
            content_hash="c" * 64,
        ),
    )
    return document_id


async def _base_with_chunks(
    session: AsyncSession, texts: list[str]
) -> tuple[uuid.UUID, uuid.UUID, list[uuid.UUID]]:
    """建一个库、一份文档并落下这几块，回库 id、文档 id 与块 id。

    Args: session, texts。
    """
    base = await crud.knowledge_base.insert_base(
        session,
        crud.knowledge_base.BaseWrite(
            name="库",
            description="",
            owner_id="t",
            embedding_model=None,
            dimensions=None,
            retrieval_strategy="hybrid",
        ),
    )
    document_id = await _seeded_document(session, base.id)
    chunk_ids = await crud.chunk.replace_chunks(
        session,
        base.id,
        document_id,
        [
            Chunk(
                ordinal=index,
                text=one,
                heading_path="",
                locator=Locator(),
                token_count=len(one),
            )
            for index, one in enumerate(texts)
        ],
    )
    return (base.id, document_id, chunk_ids)


async def test_a_written_vector_comes_back_first(
    db_sessions: object, db_dimensions: int
) -> None:
    """写进去的那条，用它自己当探针查回来必须排第一。"""
    index = PgVectorIndex(dimensions=db_dimensions)
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base_id, _document_id, chunk_ids = await _base_with_chunks(
            session, ["甲", "乙"]
        )
        near = _vector(db_dimensions, 1.0, 0.2)
        far = _vector(db_dimensions, 0.0, 1.0)
        await index.upsert(
            session,
            VectorRows(
                base_id=base_id,
                model="fake",
                dimensions=db_dimensions,
                rows=((chunk_ids[0], near), (chunk_ids[1], far)),
            ),
        )
        found = await index.search(
            session, VectorQuery(base_id=base_id, vector=near, limit=5)
        )
    assert found[0].chunk_id == chunk_ids[0]
    assert "向量近邻" in found[0].why


async def test_writing_the_same_chunk_twice_keeps_one_row(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 一个块只有一条向量：留两条的话检索会把同一段话召回两次，
    而两条里哪一条是新的从外面看不出来。"""
    index = PgVectorIndex(dimensions=db_dimensions)
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base_id, _document_id, chunk_ids = await _base_with_chunks(
            session, ["甲"]
        )
        for head in (1.0, 0.5):
            await index.upsert(
                session,
                VectorRows(
                    base_id=base_id,
                    model="fake",
                    dimensions=db_dimensions,
                    rows=((chunk_ids[0], _vector(db_dimensions, head)),),
                ),
            )
        found = await index.search(
            session,
            VectorQuery(
                base_id=base_id,
                vector=_vector(db_dimensions, 1.0),
                limit=10,
            ),
        )
    assert len(found) == 1


async def test_vectors_never_leak_across_bases(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 少了按库收窄，一个库的检索会命中另一个库的内容——
    而那是最难发现的一类越权。"""
    index = PgVectorIndex(dimensions=db_dimensions)
    probe = _vector(db_dimensions, 1.0)
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        mine, _mine_doc, my_chunks = await _base_with_chunks(session, ["甲"])
        other, _other_doc, other_chunks = await _base_with_chunks(
            session, ["甲"]
        )
        for base_id, chunk_ids in ((mine, my_chunks), (other, other_chunks)):
            await index.upsert(
                session,
                VectorRows(
                    base_id=base_id,
                    model="fake",
                    dimensions=db_dimensions,
                    rows=((chunk_ids[0], probe),),
                ),
            )
        found = await index.search(
            session, VectorQuery(base_id=mine, vector=probe, limit=10)
        )
    assert [one.chunk_id for one in found] == [my_chunks[0]]


async def test_a_wrong_width_is_refused_by_name(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 维数对不上时自己先说清楚：Postgres 那条「expected N dimensions」里
    既没有模型名也没有那个环境变量的名字，而这件事只有一种修法。"""
    index = PgVectorIndex(dimensions=db_dimensions)
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base_id, _document_id, chunk_ids = await _base_with_chunks(
            session, ["甲"]
        )
        with pytest.raises(
            VectorDimensionMismatch, match="KNOWLEDGE_EMBEDDING_DIMENSIONS"
        ):
            await index.upsert(
                session,
                VectorRows(
                    base_id=base_id,
                    model="fake",
                    dimensions=db_dimensions - 1,
                    rows=((chunk_ids[0], _vector(db_dimensions - 1, 1.0)),),
                ),
            )


async def test_deleting_a_chunk_takes_its_vector_with_it(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 级联删是库上那条外键在守：漏了它，删过的块还会被召回，
    而点开出处是一片空白。"""
    index = PgVectorIndex(dimensions=db_dimensions)
    probe = _vector(db_dimensions, 1.0)
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base_id, document_id, chunk_ids = await _base_with_chunks(
            session, ["甲"]
        )
        await index.upsert(
            session,
            VectorRows(
                base_id=base_id,
                model="fake",
                dimensions=db_dimensions,
                rows=((chunk_ids[0], probe),),
            ),
        )
        # 整份文档的块整体替换成空 = 删块；向量随外键级联走
        await crud.chunk.replace_chunks(session, base_id, document_id, [])
        found = await index.search(
            session, VectorQuery(base_id=base_id, vector=probe, limit=5)
        )
    assert found == []


async def test_trgm_ranks_by_similarity(db_sessions: object) -> None:
    """⚠ Postgres 内建分词不切中文：`to_tsvector` 给出的是整串一个词，
    任何一次部分匹配都命不中。trigram 是中文这一侧唯一能用的排序。"""
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base_id, _document_id, _chunk_ids = await _base_with_chunks(
            session, ["出口温度不得高于 65 ℃", "润滑油每 500 小时换一次"]
        )
        found = await TrgmKeywordIndex().search(
            session, KeywordQuery(base_id=base_id, text="出口温度", limit=5)
        )
    assert found
    assert found[0].score > 0
    assert "字面相似" in found[0].why


async def test_an_empty_query_matches_nothing(db_sessions: object) -> None:
    """⚠ 不拦的话，一次没填关键词的检索会把整个库倒出来。"""
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base_id, _document_id, _chunk_ids = await _base_with_chunks(
            session, ["甲", "乙"]
        )
        assert (
            await TrgmKeywordIndex().search(
                session, KeywordQuery(base_id=base_id, text="   ", limit=5)
            )
            == []
        )


async def test_keywords_never_leak_across_bases(db_sessions: object) -> None:
    """⚠ 两路都要按库收窄：漏一路就够了——那一路召回的内容属于别的库。"""
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        mine, _document_id, _chunks = await _base_with_chunks(
            session, ["出口温度"]
        )
        await _base_with_chunks(session, ["出口温度"])
        found = await TrgmKeywordIndex().search(
            session, KeywordQuery(base_id=mine, text="出口温度", limit=10)
        )
    assert len(found) == 1
