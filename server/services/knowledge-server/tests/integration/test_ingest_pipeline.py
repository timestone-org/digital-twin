"""摄取管线，打真库。

⚠ 打真库而不是假件：这条链的每一段都落在库上（状态、块、向量），而假件测出来
的是「我调了哪几个方法」。向量那一路更是只有真库能验——`vector` 列与 HNSW 都在
数据库那一侧。
"""

import uuid
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace

import pytest

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.services.indexing import (
    IndexPair,
    PgVectorIndex,
    VectorQuery,
    build_indexes,
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
# ⚠ 两节都要比切块下限长：太短的两节会被合成一块（那是刻意的，见
# `chunking/structural.py`），于是这一摞验「多块」的用例会全部退化成一块
BODY = (
    "# 冷却水\n"
    "出口温度不得高于 65 ℃。运行中每班巡检一次进出口压差，"
    "压差超过 0.15 MPa 时先清洗板式换热器再复查。补水电导率长期"
    "高于 300 μS/cm 的，按季度做一次全系统排污，排污后补水至视镜"
    "中位线，并记录本次补水量与电导率读数备查。\n\n"
    "# 润滑\n"
    "每 500 小时换一次油。换油前先取样送检，含水量超过 0.1% 或"
    "黏度偏离牌号 ±10% 的按提前换油处理。加注量以视镜中位线为准，"
    "过量会让轴承温升偏高而不报警，因此加注后要复测一次温升并留档。\n"
)


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

    dimensions: int
    id: str = "fake"
    max_input_tokens: int = 512
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
    max_input_tokens: int = 0
    can_embed: bool = False

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        del texts
        raise AssertionError("不该被调到")


class _LateEmbedder:
    """刷过目录之后才算得出向量的那一路，与生产的动态嵌入档同形。"""

    id = "late"

    def __init__(self, dimensions: int) -> None:
        self.dimensions = dimensions
        self.max_input_tokens = 512
        self.refreshes = 0
        self._is_ready = False

    @property
    def can_embed(self) -> bool:
        """刷过一次目录才算接上。"""
        return self._is_ready

    async def arrive(self) -> None:
        """一次目录刷新：拉完之后这一路就解得出端点了。"""
        self.refreshes += 1
        self._is_ready = True

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """与 `_Embedder` 同一套假向量。

        Args: texts。
        """
        return await _Embedder(dimensions=self.dimensions).embed(texts)


def _deps(source: object, embedder: object, pair: IndexPair) -> IngestDeps:
    # ⚠ 用线程池而不是进程池：解析函数与假件都定义在用例模块里，进程池要
    # pickle 它们，而 pickle 不动本地类。生产那一侧是进程池（`worker.py`）
    return IngestDeps(
        sources=(source,),  # pyright: ignore[reportArgumentType]
        embedder=embedder,  # pyright: ignore[reportArgumentType]
        indexes=pair,
        pool=ThreadPoolExecutor(max_workers=1),
        store=None,
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


def _pair(dimensions: int) -> IndexPair:
    return build_indexes(dimensions)


async def _status(sessions: object, document_id: uuid.UUID) -> str:
    async with sessions() as session:  # pyright: ignore[reportCallIssue]
        row = await crud.document.get_document(session, document_id)
        return "" if row is None else row.status


async def _chunks(sessions: object, base_id: uuid.UUID) -> int:
    async with sessions() as session:  # pyright: ignore[reportCallIssue]
        return await crud.chunk.count_chunks(session, base_id)


async def test_a_document_walks_all_the_way_to_ready(
    db_sessions: object, db_dimensions: int
) -> None:
    base_id, document_id = await _seeded(db_sessions)
    made = await ingest(
        db_sessions,  # pyright: ignore[reportArgumentType]
        _deps(
            _Source(BODY.encode("utf-8")),
            _Embedder(db_dimensions),
            _pair(db_dimensions),
        ),
        document_id,
    )
    assert made == "ready"
    assert await _status(db_sessions, document_id) == "ready"
    assert await _chunks(db_sessions, base_id) == 2


async def test_running_twice_changes_nothing(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 队列是 at-least-once，重复投递是常态：判据是**那一行的状态**，
    已经 ready 的直接跳过。"""
    base_id, document_id = await _seeded(db_sessions)
    deps = _deps(
        _Source(BODY.encode("utf-8")),
        _Embedder(db_dimensions),
        _pair(db_dimensions),
    )
    await ingest(
        db_sessions, deps, document_id
    )  # pyright: ignore[reportArgumentType]
    second = await ingest(
        db_sessions, deps, document_id
    )  # pyright: ignore[reportArgumentType]
    assert second == "skipped"
    assert await _chunks(db_sessions, base_id) == 2


async def test_no_embedder_fails_the_document_and_says_what_is_missing(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 算不出向量就别放它到 ready（ADR-0045）：一个只有块没有向量的库，
    在界面上与建好的库长得一模一样，只是永远召不回意思相近的那几段。
    理由要点得出名字——用户据它去配模型，而不是去怀疑这份文档。"""
    _base_id, document_id = await _seeded(db_sessions)
    with pytest.raises(IngestFailed, match="知识库嵌入"):
        await ingest(
            db_sessions,  # pyright: ignore[reportArgumentType]
            _deps(
                _Source(BODY.encode("utf-8")),
                _NoEmbedder(),
                _pair(db_dimensions),
            ),
            document_id,
        )


async def test_the_catalog_is_refreshed_before_asking_if_it_can_embed(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ worker 进程里没有别的地方刷模型目录：不刷的话 `can_embed` 问的是
    一份空快照，恒假——而那正是「界面说已接、库里一条向量都没有」的成因。"""
    _base_id, document_id = await _seeded(db_sessions)
    late = _LateEmbedder(db_dimensions)
    deps = replace(
        _deps(_Source(BODY.encode("utf-8")), late, _pair(db_dimensions)),
        refresh=late.arrive,
    )
    made = await ingest(
        db_sessions,  # pyright: ignore[reportArgumentType]
        deps,
        document_id,
    )
    assert made == "ready"
    assert late.refreshes == 1


async def test_the_status_is_visible_between_stages(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 每一段自己一个事务，所以中途失败时**外面看得见它停在哪**。
    整条一个事务的话，这一步会读到 pending——而那句「界面上看得见它停在哪」
    就是假的。"""
    _base_id, document_id = await _seeded(db_sessions)
    with pytest.raises(IngestFailed):
        await ingest(
            db_sessions,  # pyright: ignore[reportArgumentType]
            _deps(_Missing(), _Embedder(db_dimensions), _pair(db_dimensions)),
            document_id,
        )
    assert await _status(db_sessions, document_id) == "parsing"


async def test_a_missing_original_fails_without_retrying(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 与「此刻拿不到」分开：原件没了重试一万次也一样。"""
    _base_id, document_id = await _seeded(db_sessions)
    with pytest.raises(IngestFailed, match="不在对象存储里"):
        await ingest(
            db_sessions,  # pyright: ignore[reportArgumentType]
            _deps(_Missing(), _Embedder(db_dimensions), _pair(db_dimensions)),
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
    db_sessions: object, db_dimensions: int
) -> None:
    """文档在消息还在路上的时候被删了：不是错误，安静收工。"""
    made = await ingest(
        db_sessions,  # pyright: ignore[reportArgumentType]
        _deps(
            _Source(BODY.encode("utf-8")),
            _Embedder(db_dimensions),
            _pair(db_dimensions),
        ),
        uuid.uuid4(),
    )
    assert made == "skipped"


async def test_the_indexed_chunk_comes_back_from_pgvector(
    db_sessions: object, db_dimensions: int
) -> None:
    """摄取跑完，块的向量必须真的在向量表里查得到。

    ⚠ 这一条守的是「嵌入那一段真的落了库」：只断言状态到了 ready 的话，
    一个跳过嵌入、一条向量都不写的实现照样全绿。
    """
    base_id, document_id = await _seeded(db_sessions)
    embedder = _Embedder(db_dimensions)
    await ingest(
        db_sessions,  # pyright: ignore[reportArgumentType]
        _deps(_Source(BODY.encode("utf-8")), embedder, _pair(db_dimensions)),
        document_id,
    )
    probe = (await embedder.embed(["出口温度不得高于 65 ℃"]))[0]
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        found = await PgVectorIndex(dimensions=db_dimensions).search(
            session, VectorQuery(base_id=base_id, vector=probe, limit=5)
        )
    assert found
    assert all(one.score > 0 for one in found)
    assert all("向量近邻" in one.why for one in found)


async def test_a_reingest_replaces_the_old_vectors(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 重新解析会整体换掉块，向量随外键级联删——补不回来的话，那份文档
    在检索里就此消失，而它的状态是 ready。"""
    base_id, document_id = await _seeded(db_sessions)
    embedder = _Embedder(db_dimensions)
    deps = _deps(_Source(BODY.encode("utf-8")), embedder, _pair(db_dimensions))
    await ingest(
        db_sessions,  # pyright: ignore[reportArgumentType]
        deps,
        document_id,
    )
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        await crud.document.mark_status(session, document_id, "pending")
    await ingest(
        db_sessions,  # pyright: ignore[reportArgumentType]
        deps,
        document_id,
    )
    probe = (await embedder.embed(["出口温度不得高于 65 ℃"]))[0]
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        found = await PgVectorIndex(dimensions=db_dimensions).search(
            session, VectorQuery(base_id=base_id, vector=probe, limit=10)
        )
    assert len(found) == await _chunks(db_sessions, base_id)
