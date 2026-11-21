"""保留历史引用，同时从活动清单和检索中排除历史、待接替版本。"""

import hashlib
import uuid
from dataclasses import dataclass

import pytest
from integration.conftest import DbStack
from integration.test_reembedding_worker import (
    LocalEmbedder,
    Sessions,
    local_space,
    unchanged,
)

from knowledge_server.apps.knowledge.crud import reembedding as jobs
from knowledge_server.apps.knowledge.models import (
    KnowledgeChunk,
    KnowledgeDocument,
)
from knowledge_server.apps.knowledge.schemas.reembedding import (
    ReembeddingStartIn,
)
from knowledge_server.apps.knowledge.services import reembedding
from knowledge_server.apps.knowledge.services.embedding.space import tag
from knowledge_server.apps.knowledge.services.indexing import (
    KeywordQuery,
    VectorQuery,
    VectorRows,
    build_indexes,
)
from knowledge_server.apps.knowledge.services.reembedding_worker import (
    ReembeddingSteps,
)
from knowledge_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres
BASES = f"{API_PREFIX}/knowledge-bases"


@dataclass
class SourceVersions:
    base: uuid.UUID
    documents: list[uuid.UUID]
    chunks: list[uuid.UUID]


@pytest.fixture
async def versions(db_stack: DbStack, db_dimensions: int) -> SourceVersions:
    made = (await db_stack.client.post(BASES, json={"name": "源版本"})).json()[
        "data"
    ]
    base = uuid.UUID(made["id"])
    source = (await db_stack.client.get(f"{BASES}/{base}/sources")).json()[
        "data"
    ][0]["id"]
    documents, chunks = [], []
    async with db_stack.sessions() as session:
        for state in (None, "current", "pending", "historical"):
            label = str(state)
            row = KnowledgeDocument(
                base_id=base,
                source_id=uuid.UUID(source),
                title=label,
                external_ref=label,
                object_key=label,
                byte_size=1,
                content_hash=hashlib.sha256(label.encode()).hexdigest(),
                status="ready",
                chunk_count=1,
                source_revision_state=state,
            )
            session.add(row)
            await session.flush()
            chunk = KnowledgeChunk(
                base_id=base, document_id=row.id, ordinal=0, text="合成知识文档"
            )
            session.add(chunk)
            await session.flush()
            documents.append(row.id)
            chunks.append(chunk.id)
        vector = [1.0] + [0.0] * (db_dimensions - 1)
        await build_indexes(db_dimensions).vector.upsert(
            session,
            VectorRows(
                base,
                tag(local_space(db_dimensions).identity),
                db_dimensions,
                tuple((cid, vector) for cid in chunks),
            ),
        )
        await session.commit()
    return SourceVersions(base, documents, chunks)


async def test_current_list_and_citation_use_their_own_visibility(
    db_stack: DbStack, versions: SourceVersions
) -> None:
    base = versions.base
    rows = (
        await db_stack.client.get(
            f"{API_PREFIX}/documents", params={"base_id": str(base)}
        )
    ).json()["data"]
    assert {row["id"] for row in rows["items"]} == {
        str(d) for d in versions.documents[:2]
    }
    assert (await db_stack.client.get(f"{BASES}/{base}")).json()["data"][
        "document_count"
    ] == 2
    old = await db_stack.client.get(
        f"{BASES}/{base}/chunks/{versions.chunks[-1]}"
    )
    assert old.status_code == 200
    assert old.json()["data"]["text"] == "合成知识文档"
    still_readable = await db_stack.client.get(
        f"{API_PREFIX}/documents/{versions.documents[-1]}"
    )
    assert still_readable.status_code == 200
    rejected = await db_stack.client.post(
        f"{API_PREFIX}/documents/{versions.documents[-1]}:reparse"
    )
    assert rejected.status_code == 409


async def test_keyword_and_vector_search_recall_current_versions(
    db_sessions: Sessions, db_dimensions: int, versions: SourceVersions
) -> None:
    pair = build_indexes(db_dimensions)
    space = local_space(db_dimensions)
    visible = set(versions.chunks[:2])
    vector = [1.0] + [0.0] * (db_dimensions - 1)
    async with db_sessions() as session:
        keyword = await pair.keyword.search(
            session, KeywordQuery(versions.base, "合成知识文档", 10)
        )
        original = await pair.vector.search(
            session, VectorQuery(versions.base, vector, 10, tag(space.identity))
        )
        assert {x.chunk_id for x in keyword} == visible
        assert {x.chunk_id for x in original} == visible
        preview = await reembedding.preview(session, versions.base, space)
        assert (preview.total_documents, preview.total_chunks) == (3, 3)
        start = reembedding.StartRequest(
            versions.base,
            uuid.uuid4(),
            "source-versions",
            ReembeddingStartIn(
                target_space_id=space.identity,
                expected_revision=preview.content_revision,
            ),
        )
        job = await reembedding.start(session, start, space)
    worker = ReembeddingSteps(
        db_sessions, LocalEmbedder(db_dimensions), unchanged, 16
    )
    await worker.run_one()
    await worker.run_one()
    async with db_sessions() as session:
        assert await jobs.count_vectors(session, job.id) == 3
        published = await pair.vector.search(
            session,
            VectorQuery(versions.base, vector, 10, tag(space.identity), job.id),
        )
        assert {v.chunk_id for v in published} == visible
