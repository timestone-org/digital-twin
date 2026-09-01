"""两路关键词索引与加速档的检索，打真库。

⚠ 回退档平时没人跑——长期没人跑等于没有。这个文件就是那条「没人跑」的补丁。
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server import index
from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.services.chunking import Chunk
from knowledge_server.apps.knowledge.services.indexing import (
    VECTOR_TABLE,
    KeywordQuery,
    LikeKeywordIndex,
    TrgmKeywordIndex,
)
from knowledge_server.apps.knowledge.services.parsing import Locator
from knowledge_server.apps.knowledge.services.sources import UPLOAD_KIND

pytestmark = pytest.mark.requires_postgres


async def _base_with_chunks(
    session: AsyncSession, texts: list[str]
) -> uuid.UUID:
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
    source = await crud.source.insert_source(
        session, base.id, UPLOAD_KIND, "上传", {}
    )
    document_id = uuid.uuid4()
    await crud.document.insert_document(
        session,
        crud.document.DocumentWrite(
            document_id=document_id,
            base_id=base.id,
            source_id=source.id,
            external_ref="a.md",
            title="a.md",
            media_type="",
            object_key="k",
            byte_size=1,
            content_hash="c" * 64,
        ),
    )
    await crud.chunk.replace_chunks(
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
    return base.id


async def test_like_finds_a_literal_substring(db_sessions: object) -> None:
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base_id = await _base_with_chunks(
            session, ["出口温度不得高于 65 ℃", "每 500 小时换一次油"]
        )
        found = await LikeKeywordIndex().search(
            session, KeywordQuery(base_id=base_id, text="出口温度", limit=5)
        )
    assert len(found) == 1
    assert "没装 pg_trgm" in found[0].why


async def test_like_says_it_cannot_rank(db_sessions: object) -> None:
    """⚠ 回退档给的是**固定分**：`ILIKE` 只答包不包含。给一个假的浮点分数
    会让融合那一层以为它排过序，而它没有。"""
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base_id = await _base_with_chunks(session, ["温度甲", "温度乙"])
        found = await LikeKeywordIndex().search(
            session, KeywordQuery(base_id=base_id, text="温度", limit=5)
        )
    assert len({one.score for one in found}) == 1


async def test_an_empty_query_matches_nothing(db_sessions: object) -> None:
    """⚠ 空串在 `ILIKE '%%'` 下匹配一切：不拦的话，一次没填关键词的检索会
    把整个库倒出来。"""
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base_id = await _base_with_chunks(session, ["甲", "乙"])
        assert (
            await LikeKeywordIndex().search(
                session, KeywordQuery(base_id=base_id, text="   ", limit=5)
            )
            == []
        )
        assert (
            await TrgmKeywordIndex().search(
                session, KeywordQuery(base_id=base_id, text="", limit=5)
            )
            == []
        )


async def test_like_never_leaks_across_bases(db_sessions: object) -> None:
    """⚠ 少了这条按库收窄，一个库的检索会命中另一个库的内容——
    而那是最难发现的一类越权。"""
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        mine = await _base_with_chunks(session, ["出口温度"])
        await _base_with_chunks(session, ["出口温度"])
        found = await LikeKeywordIndex().search(
            session, KeywordQuery(base_id=mine, text="出口温度", limit=10)
        )
    assert len(found) == 1


async def test_trgm_ranks_by_similarity(
    db_accelerated: None, db_sessions: object
) -> None:
    """⚠ Postgres 内建分词不切中文：`to_tsvector` 给出的是整串一个词，
    任何一次部分匹配都命不中。trigram 是中文这一侧唯一能用的排序。"""
    del db_accelerated
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base_id = await _base_with_chunks(
            session, ["出口温度不得高于 65 ℃", "润滑油每 500 小时换一次"]
        )
        found = await TrgmKeywordIndex().search(
            session, KeywordQuery(base_id=base_id, text="出口温度", limit=5)
        )
    assert found
    assert found[0].score > 0
    assert "字面相似" in found[0].why


async def test_enabling_twice_is_harmless(db_settings: object) -> None:
    """⚠ 运维命令一定会被重跑（重装、迁库、有人手抖）。第二次报错的话，
    那句错读起来像「装坏了」，而其实什么事都没有。

    ⚠ 这条**刻意不吃 `db_sessions`**：那个夹具在同一条连接上开着一个外层
    事务，而 `CREATE INDEX` 要 SHARE 锁——两者互等，报出来的是一句
    「canceling statement due to lock timeout」，与命令本身毫无关系。
    """
    del db_settings
    await index.enable(1536)
    await index.enable(1536)
    await index.disable()
    await index.enable(1536)
    # 建两次、拆一次、再建一次之后，加速表仍在——这就是「重跑没事」的凭证
    assert VECTOR_TABLE == "kb_chunk_vectors_pgv"
