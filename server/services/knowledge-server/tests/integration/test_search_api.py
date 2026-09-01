"""检索面，打真库。整条链走通：传文档 → 摄取 → 检索 → 带出处的召回。"""

import uuid
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import httpx
import pytest

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.schemas import SearchIn
from knowledge_server.apps.knowledge.services import search_service
from knowledge_server.apps.knowledge.services.indexing import (
    BruteForceIndex,
    IndexPair,
    LikeKeywordIndex,
)
from knowledge_server.apps.knowledge.services.ingest_pipeline import (
    IngestDeps,
    ingest,
)
from knowledge_server.apps.knowledge.services.parsing import RawItem
from knowledge_server.apps.knowledge.services.retrieval import (
    RetrievalDeps,
    build_strategies,
)
from knowledge_server.apps.knowledge.services.sources import UPLOAD_KIND
from knowledge_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

BASES = f"{API_PREFIX}/knowledge-bases"
DOCS = f"{API_PREFIX}/documents"

BODY = "# 冷却水\n出口温度不得高于 65 ℃\n\n# 润滑\n每 500 小时换一次油\n"


@dataclass(frozen=True)
class FakeEmbedder:
    """按正文长度造一条稳定的假向量。"""

    dimensions: int = 4
    id: str = "fake"
    can_embed: bool = True

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [
            [float(len(one) % 7), 1.0, 0.5, float(len(one) % 3)]
            for one in texts
        ]


@dataclass(frozen=True)
class FakeSource:
    """把固定的一份原件交回去的假来源。"""

    kind: str = UPLOAD_KIND

    def config_schema(self) -> dict[str, object]:
        return {}

    async def discover(
        self, config: dict[str, object], cursor: str | None
    ) -> object:
        del config, cursor
        raise NotImplementedError

    async def fetch(self, config: dict[str, object], ref: str) -> RawItem:
        del config, ref
        return RawItem(
            filename="手册.md",
            media_type="text/markdown",
            content=BODY.encode("utf-8"),
        )


def ingest_deps(embedder: FakeEmbedder) -> IngestDeps:
    return IngestDeps(
        sources=(FakeSource(),),  # pyright: ignore[reportArgumentType]
        embedder=embedder,  # pyright: ignore[reportArgumentType]
        indexes=IndexPair(vector=BruteForceIndex(), keyword=LikeKeywordIndex()),
        pool=ThreadPoolExecutor(max_workers=1),
        parse_timeout_s=30.0,
    )


async def seeded(sessions: object) -> tuple[uuid.UUID, uuid.UUID]:
    """建库、建来源、登记一份 pending 文档，自己一个事务。"""
    document_id = uuid.uuid4()
    async with sessions() as session:  # pyright: ignore[reportCallIssue]
        base = await crud.knowledge_base.insert_base(
            session,
            crud.knowledge_base.BaseWrite(
                name="手册库",
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
        base_id = base.id
        await crud.document.insert_document(
            session,
            crud.document.DocumentWrite(
                document_id=document_id,
                base_id=base_id,
                source_id=source.id,
                external_ref="手册.md",
                title="手册.md",
                media_type="text/markdown",
                object_key="k",
                byte_size=len(BODY),
                content_hash="d" * 64,
            ),
        )
    return (base_id, document_id)


async def _base(client: httpx.AsyncClient, strategy: str = "hybrid") -> str:
    response = await client.post(
        BASES, json={"name": "手册库", "retrieval_strategy": strategy}
    )
    return str(response.json()["data"]["id"])


async def _uploaded(client: httpx.AsyncClient, base_id: str) -> str:
    ticket = await client.post(
        f"{DOCS}:upload-ticket",
        params={"base_id": base_id},
        json={"filename": "手册.md", "size_bytes": 12},
    )
    made = ticket.json()["data"]
    registered = await client.post(
        DOCS,
        params={"base_id": base_id},
        json={"document_id": made["document_id"], "filename": "手册.md"},
    )
    return str(registered.json()["data"]["id"])


async def test_searching_a_base_with_no_documents_is_empty_not_an_error(
    db_client: httpx.AsyncClient,
) -> None:
    """空库检索得到空表——这与「检索不了」是两件事，后者回 409。"""
    base_id = await _base(db_client)
    response = await db_client.post(
        f"{BASES}/{base_id}:search", json={"query": "出口温度"}
    )
    assert response.status_code == httpx.codes.OK
    assert response.json()["data"]["hits"] == []


async def test_hybrid_says_it_only_ran_the_keyword_lane(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 没接嵌入档时**退成只走关键词并把这件事写进 note**。这不是悄悄退化：
    悄悄退化指的是不告诉任何人，而这里说了——关键词那一路本来就不需要嵌入。"""
    base_id = await _base(db_client)
    response = await db_client.post(
        f"{BASES}/{base_id}:search", json={"query": "出口温度"}
    )
    body = response.json()["data"]
    assert body["strategy"] == "hybrid"
    assert "没接嵌入档" in body["note"]


async def test_naive_refuses_instead_of_returning_nothing(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 单向量那一路没了嵌入就真的做不了。回空表的话，调用方会把它读成
    「查过了，没有」然后接着往下走。"""
    base_id = await _base(db_client, "naive")
    response = await db_client.post(
        f"{BASES}/{base_id}:search", json={"query": "出口温度"}
    )
    assert response.status_code == httpx.codes.CONFLICT
    assert response.json()["code"] == 42306


async def test_an_unknown_strategy_is_refused(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 退回默认的表现是「点名的策略一直没生效」，而界面上看着一切正常。"""
    base_id = await _base(db_client)
    response = await db_client.post(
        f"{BASES}/{base_id}:search",
        json={"query": "甲", "strategy": "乱写的"},
    )
    assert response.status_code == httpx.codes.BAD_REQUEST
    assert response.json()["code"] == 42305


async def test_searching_a_missing_base_is_404(
    db_client: httpx.AsyncClient,
) -> None:
    response = await db_client.post(
        f"{BASES}/{uuid.uuid4()}:search", json={"query": "甲"}
    )
    assert response.status_code == httpx.codes.NOT_FOUND


async def test_an_empty_query_is_refused(
    db_client: httpx.AsyncClient,
) -> None:
    base_id = await _base(db_client)
    response = await db_client.post(
        f"{BASES}/{base_id}:search", json={"query": ""}
    )
    assert response.status_code == httpx.codes.BAD_REQUEST


async def test_the_limit_has_a_ceiling(db_client: httpx.AsyncClient) -> None:
    """⚠ 分页无上限就是一次 OOM（api-contract §5）。"""
    base_id = await _base(db_client)
    response = await db_client.post(
        f"{BASES}/{base_id}:search",
        json={"query": "甲", "limit": 1_000_000},
    )
    assert response.status_code == httpx.codes.BAD_REQUEST


async def test_a_registered_document_is_not_searchable_until_ingested(
    db_client: httpx.AsyncClient,
) -> None:
    """刚登记的文档还在 pending：块还没落库，检索当然找不到它。
    这条钉的是「摄取是异步的」这件事对检索侧的可见后果。"""
    base_id = await _base(db_client)
    await _uploaded(db_client, base_id)
    response = await db_client.post(
        f"{BASES}/{base_id}:search", json={"query": "标题"}
    )
    assert response.json()["data"]["hits"] == []


async def test_an_ingested_document_comes_back_with_its_citation(
    db_sessions: object,
) -> None:
    """整条链走通：摄取 → 检索 → 召回带着**指得到块**的出处。

    ⚠ 引用指到块不指到文档：指到文档的话，用户拿到的是「答案在这份 200 页的
    手册里」，而那等于没给出处。
    """
    base_id, document_id = await seeded(db_sessions)
    embedder = FakeEmbedder()
    await ingest(
        db_sessions,  # pyright: ignore[reportArgumentType]
        ingest_deps(embedder),
        document_id,
    )
    lanes = build_strategies(
        RetrievalDeps(
            indexes=IndexPair(
                vector=BruteForceIndex(), keyword=LikeKeywordIndex()
            ),
            embedder=embedder,  # pyright: ignore[reportArgumentType]
        )
    )
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        made = await search_service.search(
            session,
            lanes,
            base_id,
            SearchIn(query="出口温度", limit=5),
        )
    assert made.hits
    first = made.hits[0]
    assert first.document_title == "手册.md"
    assert first.chunk_id
    assert first.heading_path
    assert first.why
