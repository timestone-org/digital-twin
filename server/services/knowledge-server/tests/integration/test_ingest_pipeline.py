"""摄取管线，打真库。两路索引各跑一遍。

⚠ 索引档的两条实现只有真库能分开验：pgvector 装没装决定走哪一路，而回退档
平时没人跑——长期没人跑等于没有。
"""

import uuid
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import pytest

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.services.indexing import (
    BruteForceIndex,
    IndexPair,
    LikeKeywordIndex,
    PgVectorIndex,
    TrgmKeywordIndex,
    VectorQuery,
)
from knowledge_server.apps.knowledge.services.ingest_pipeline import (
    IngestDeps,
    IngestFailed,
    ingest,
    mark_failed,
)
from knowledge_server.apps.knowledge.services.parsing import RawItem
from knowledge_server.apps.knowledge.services.sources import UPLOAD_KIND

pytestmark = pytest.mark.requires_postgres

# 一份小 markdown，够切出两块
BODY = "# 冷却水\n出口温度不得高于 65 ℃\n\n# 润滑\n每 500 小时换一次油\n"


@dataclass(frozen=True)
class _Source:
    """把固定的一份原件交回去的假来源。"""

    content: bytes
    kind: str = UPLOAD_KIND

    def config_schema(self) -> dict[str, object]:
        return {}

    async def discover(
        self, config: dict[str, object], cursor: str | None
    ) -> object:
        del config, cursor
        raise NotImplementedError

    async def fetch(self, config: dict[str, object], ref: str) -> RawItem:
        del config
        return RawItem(
            filename=ref, media_type="text/markdown", content=self.content
        )


@dataclass(frozen=True)
class _Missing:
    """原件已经不在了的假来源。"""

    kind: str = UPLOAD_KIND

    def config_schema(self) -> dict[str, object]:
        return {}

    async def discover(
        self, config: dict[str, object], cursor: str | None
    ) -> object:
        del config, cursor
        raise NotImplementedError

    async def fetch(self, config: dict[str, object], ref: str) -> RawItem:
        del config
        raise FileNotFoundError(ref)


@dataclass(frozen=True)
class _Embedder:
    """按块正文长度造一条稳定的假向量。

    ⚠ 造出来的维数必须**真的等于** `dimensions`：`vector(N)` 的 N 是建表时
    定死的，对不上时 pgvector 回的是一条「expected N dimensions」——而那条错
    不会提到「你的嵌入档换过维数」。
    """

    dimensions: int = 4
    id: str = "fake"
    can_embed: bool = True

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        made: list[list[float]] = []
        for one in texts:
            head = [float(len(one) % 7), 1.0, 0.5, float(len(one) % 3)]
            made.append((head + [0.0] * self.dimensions)[: self.dimensions])
        return made


@dataclass(frozen=True)
class _NoEmbedder:
    dimensions: int = 0
    id: str = "none"
    can_embed: bool = False

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        del texts
        raise AssertionError("不该被调到")


def _deps(source: object, embedder: object, pair: IndexPair) -> IngestDeps:
    # ⚠ 用线程池而不是进程池：解析函数与假件都定义在用例模块里，进程池要
    # pickle 它们，而 pickle 不动本地类。生产那一侧是进程池（`worker.py`）
    return IngestDeps(
        sources=(source,),  # pyright: ignore[reportArgumentType]
        embedder=embedder,  # pyright: ignore[reportArgumentType]
        indexes=pair,
        pool=ThreadPoolExecutor(max_workers=1),
        parse_timeout_s=30.0,
        batch_size=2,
    )


async def _seeded(sessions: object) -> tuple[uuid.UUID, uuid.UUID]:
    """建一个库、一路来源、一份 pending 文档，**自己一个事务**。

    ⚠ 种完就出块提交：被测的管线每一段都自己开事务，而同一条连接上不能同时
    开着两个会话——种子还没出块就调管线的话，第二个会话拿到的是一条正在用的
    连接。
    """
    document_id = uuid.uuid4()
    async with sessions() as session:  # pyright: ignore[reportCallIssue]
        base = await crud.knowledge_base.insert_base(
            session,
            crud.knowledge_base.BaseWrite(
                name="手册库",
                description="",
                owner_id="tester",
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
                content_hash="a" * 64,
            ),
        )
    return (base_id, document_id)


def _pair() -> IndexPair:
    return IndexPair(vector=BruteForceIndex(), keyword=LikeKeywordIndex())


async def _status(sessions: object, document_id: uuid.UUID) -> str:
    async with sessions() as session:  # pyright: ignore[reportCallIssue]
        row = await crud.document.get_document(session, document_id)
        return "" if row is None else row.status


async def _chunks(sessions: object, base_id: uuid.UUID) -> int:
    async with sessions() as session:  # pyright: ignore[reportCallIssue]
        return await crud.chunk.count_chunks(session, base_id)


async def test_a_document_walks_all_the_way_to_ready(
    db_sessions: object,
) -> None:
    base_id, document_id = await _seeded(db_sessions)
    made = await ingest(
        db_sessions,  # pyright: ignore[reportArgumentType]
        _deps(_Source(BODY.encode("utf-8")), _Embedder(), _pair()),
        document_id,
    )
    assert made == "ready"
    assert await _status(db_sessions, document_id) == "ready"
    assert await _chunks(db_sessions, base_id) == 2


async def test_running_twice_changes_nothing(db_sessions: object) -> None:
    """⚠ 队列是 at-least-once，重复投递是常态：判据是**那一行的状态**，
    已经 ready 的直接跳过。"""
    base_id, document_id = await _seeded(db_sessions)
    deps = _deps(_Source(BODY.encode("utf-8")), _Embedder(), _pair())
    await ingest(
        db_sessions, deps, document_id
    )  # pyright: ignore[reportArgumentType]
    second = await ingest(
        db_sessions, deps, document_id
    )  # pyright: ignore[reportArgumentType]
    assert second == "skipped"
    assert await _chunks(db_sessions, base_id) == 2


async def test_no_embedder_still_reaches_ready(db_sessions: object) -> None:
    """⚠ 判成 failed 的话，用户会以为是这份文档有问题——而其实是这套部署
    没接嵌入档。文档解析了、切块了、落库了，只是没有向量。"""
    base_id, document_id = await _seeded(db_sessions)
    made = await ingest(
        db_sessions,  # pyright: ignore[reportArgumentType]
        _deps(_Source(BODY.encode("utf-8")), _NoEmbedder(), _pair()),
        document_id,
    )
    assert made == "ready"
    assert await _chunks(db_sessions, base_id) == 2


async def test_the_status_is_visible_between_stages(
    db_sessions: object,
) -> None:
    """⚠ 每一段自己一个事务，所以中途失败时**外面看得见它停在哪**。
    整条一个事务的话，这一步会读到 pending——而那句「界面上看得见它停在哪」
    就是假的。"""
    _base_id, document_id = await _seeded(db_sessions)
    with pytest.raises(IngestFailed):
        await ingest(
            db_sessions,  # pyright: ignore[reportArgumentType]
            _deps(_Missing(), _Embedder(), _pair()),
            document_id,
        )
    assert await _status(db_sessions, document_id) == "parsing"


async def test_a_missing_original_fails_without_retrying(
    db_sessions: object,
) -> None:
    """⚠ 与「此刻拿不到」分开：原件没了重试一万次也一样。"""
    _base_id, document_id = await _seeded(db_sessions)
    with pytest.raises(IngestFailed, match="不在对象存储里"):
        await ingest(
            db_sessions,  # pyright: ignore[reportArgumentType]
            _deps(_Missing(), _Embedder(), _pair()),
            document_id,
        )


async def test_a_failure_reason_lands_on_the_row(
    db_sessions: object,
) -> None:
    """⚠ 状态落在行上而不是内存里：worker 重启一次就把「卡在哪一步」全丢了，
    而界面上表现为「一直在处理中」。"""
    _base_id, document_id = await _seeded(db_sessions)
    await mark_failed(
        db_sessions,  # pyright: ignore[reportArgumentType]
        document_id,
        "认不出这是什么格式",
    )
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        row = await crud.document.get_document(session, document_id)
    assert row is not None
    assert row.status == "failed"
    assert row.failure_reason == "认不出这是什么格式"


async def test_a_missing_document_is_not_an_error(
    db_sessions: object,
) -> None:
    """文档在消息还在路上的时候被删了：不是错误，安静收工。"""
    made = await ingest(
        db_sessions,  # pyright: ignore[reportArgumentType]
        _deps(_Source(BODY.encode("utf-8")), _Embedder(), _pair()),
        uuid.uuid4(),
    )
    assert made == "skipped"


async def test_bruteforce_finds_the_chunk_it_indexed(
    db_sessions: object,
) -> None:
    base_id, document_id = await _seeded(db_sessions)
    index = BruteForceIndex()
    await ingest(
        db_sessions,  # pyright: ignore[reportArgumentType]
        _deps(
            _Source(BODY.encode("utf-8")),
            _Embedder(),
            IndexPair(vector=index, keyword=LikeKeywordIndex()),
        ),
        document_id,
    )
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        found = await index.search(
            session,
            VectorQuery(base_id=base_id, vector=[1.0, 1.0, 0.5, 1.0], limit=5),
        )
    assert found
    assert all(one.score > 0 for one in found)
    assert all("余弦" in one.why for one in found)


async def test_pgvector_writes_both_sides(
    db_accelerated: None, db_sessions: object
) -> None:
    """⚠ 加速档在写的时候**两边都写**：只写加速表的话，一次「重建索引」就要
    把整库重新嵌入一遍，而那是按 token 计费的。"""
    del db_accelerated
    base_id, document_id = await _seeded(db_sessions)
    fallback = BruteForceIndex()
    await ingest(
        db_sessions,  # pyright: ignore[reportArgumentType]
        _deps(
            _Source(BODY.encode("utf-8")),
            _Embedder(dimensions=1536),
            IndexPair(
                vector=PgVectorIndex(fallback=fallback),
                keyword=TrgmKeywordIndex(),
            ),
        ),
        document_id,
    )
    probe = [1.0, 1.0, 0.5, 1.0] + [0.0] * 1532
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        bytea = await fallback.search(
            session, VectorQuery(base_id=base_id, vector=probe, limit=5)
        )
        accel = await PgVectorIndex(fallback=fallback).search(
            session, VectorQuery(base_id=base_id, vector=probe, limit=5)
        )
    assert bytea, "bytea 那份真相必须也写了——不然重建索引要重新花一次钱"
    assert accel
    assert {one.chunk_id for one in accel} == {one.chunk_id for one in bytea}
