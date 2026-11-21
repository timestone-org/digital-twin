"""长期记忆的仓储：写一条、查最像的几条（ADR-0030）。

⚠ **`scope` 与 `owner_id` 的过滤写在这一层**，不写在调用点。这是本模块唯一的
安全条款：助手代表用户行事，绝不能让 A 用户记的东西被 B 检索到。写在调用点的话，
下一个调用点漏掉它不会报错，只会多召回几条别人的。

⚠ 嵌入算不出来时**仍然写入**：存文本、标「没有向量」。丢掉比记不全更坏。补救走
**下一次检索惰性补算**，而不是另建一条关键词召回——两条召回路径意味着两套口径，
迟早给出不同结果，那时「为什么这条查得到那条查不到」没人答得上来。
"""

import hashlib
import time
from collections.abc import Callable, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.models import KnowledgeChunk
from ai_assistant.apps.chat.models.knowledge import EMBEDDING_MODEL_MAX_LENGTH
from ai_assistant.apps.chat.services.memory.ports import (
    Hit,
    Knowledge,
    Remembered,
    Scope,
    SearchReport,
)
from ai_assistant.llm import EmbeddingAdapter
from lib import vectors
from lib.logging import get_logger
from llmcore.embedding_snapshot import EmbeddingBatch
from llmcore.ports import SnapshotEmbeddingAdapter

_logger = get_logger("assistant.memory")

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# 一次检索最多惰性补算几条。⚠ 有上限：一次「查一下」不该顺手变成几百次嵌入调用，
# 那会让第一次检索慢到看着像挂了。补不完的下次接着补
MAX_BACKFILL = 20
# 一次最多取回多少条来算余弦。⚠ 有上限：应用层检索的代价随条目数线性涨，
# 而这一档是 ADR-0030 里那条「什么时候该换 pgvector」的触发点
MAX_SCANNED = 2000


def _model_label(model: str) -> str:
    if len(model) <= EMBEDDING_MODEL_MAX_LENGTH:
        return model
    return "sha256:" + hashlib.sha256(model.encode()).hexdigest()


def _assign(
    row: KnowledgeChunk, batch: EmbeddingBatch, vector: list[float]
) -> None:
    encoded = vectors.encode(vector)
    row.embedding = encoded
    row.embedding_space_id = batch.identity
    row.embedding_checksum = hashlib.sha256(encoded).hexdigest()
    row.embedding_model = _model_label(batch.model)
    row.dimensions = len(vector)


def _holds(row: KnowledgeChunk, batch: EmbeddingBatch) -> bool:
    return (
        row.embedding is not None
        and row.embedding_space_id == batch.identity
        and row.embedding_model == _model_label(batch.model)
        and row.dimensions == len(batch.vectors[0])
        and row.embedding_checksum == hashlib.sha256(row.embedding).hexdigest()
    )


@dataclass(frozen=True)
class PgLongTermStore:
    """落在 `assistant.knowledge_chunks` 上的那一路。

    ⚠ `embedder` 可以是 `None`——本部署没接嵌入档时仍然记得住，只是检索用不了。
    真正可缺席的是嵌入而不是仓储：库总是在的。
    """

    sessions: SessionFactory
    embedder: EmbeddingAdapter | None = None

    @property
    def can_rank(self) -> bool:
        """检索排得了序吗。没接嵌入档时排不了，由调用方如实告诉用户。

        ⚠ 问的是**此刻**：嵌入那一路的端点来自运行期可改的目录，装配了
        不等于此刻解得出端点。
        """
        return (
            isinstance(self.embedder, SnapshotEmbeddingAdapter)
            and self.embedder.is_ready
        )

    async def remember(self, item: Knowledge) -> Remembered:
        """记一条，回它的 id。

        Args: item。
        """
        batch = await self._embed_many([f"{item.title}\n{item.body}"])
        row = KnowledgeChunk(
            scope=item.scope,
            owner_id=item.owner_id,
            title=item.title,
            body=item.body,
        )
        if batch is not None:
            _assign(row, batch, batch.vectors[0])
        async with self.sessions() as session:
            session.add(row)
            await session.flush()
            identifier = str(row.id)
        return Remembered(
            id=identifier,
            is_searchable=batch is not None and self._is_current(batch),
        )

    async def search(
        self, query: str, scope: Scope, owner_id: str, limit: int
    ) -> list[Hit]:
        """按相似度读取已验证的候选。Args: query, scope, owner_id, limit。"""
        return (await self.search_report(query, scope, owner_id, limit)).hits

    async def search_report(
        self, query: str, scope: Scope, owner_id: str, limit: int
    ) -> SearchReport:
        """在所属记忆中检索并报告完整性。

        Args: query, scope, owner_id, limit。
        """
        started = time.monotonic()
        batch = await self._embed_many([query])
        if batch is None:
            return SearchReport([], False, "嵌入不可用，本次记忆检索未完成。")
        rows = await self._rows_of(scope, owner_id)
        scanned = rows[:MAX_SCANNED]
        pending = [row for row in scanned if not _holds(row, batch)]
        await self._backfill(pending[:MAX_BACKFILL], batch)
        if not self._is_current(batch):
            return SearchReport(
                [], False, "本次检索期间向量空间已切换，请重新查询。"
            )
        comparable = [row for row in scanned if _holds(row, batch)]
        hits = _ranked(comparable, batch.vectors[0], limit)
        complete = len(comparable) == len(rows)
        _logger.info(
            "memory_search",
            "一次长期记忆检索",
            scope=scope,
            scanned=len(scanned),
            hits=len(hits),
            elapsed_ms=round((time.monotonic() - started) * 1000),
        )
        return SearchReport(
            hits,
            complete,
            "" if complete else "记忆扫描或补算未完成，仅返回已核验的匹配。",
        )

    async def _rows_of(
        self, scope: Scope, owner_id: str
    ) -> list[KnowledgeChunk]:
        async with self.sessions() as session:
            found = await session.execute(
                select(KnowledgeChunk)
                .where(KnowledgeChunk.scope == scope)
                .where(KnowledgeChunk.owner_id == owner_id)
                .order_by(
                    KnowledgeChunk.created_at.desc(), KnowledgeChunk.id.desc()
                )
                .limit(MAX_SCANNED + 1)
            )
            return list(found.scalars().all())

    async def _backfill(
        self, rows: Sequence[KnowledgeChunk], space: EmbeddingBatch
    ) -> None:
        if not rows:
            return
        batch = await self._embed_many(
            [f"{row.title}\n{row.body}" for row in rows]
        )
        if batch is None or batch.identity != space.identity:
            return
        async with self.sessions() as session:
            for row, vector in zip(rows, batch.vectors, strict=True):
                stored = await session.get(
                    KnowledgeChunk, row.id, with_for_update=True
                )
                if stored is None:
                    continue
                if (
                    stored.embedding_checksum != row.embedding_checksum
                    or stored.embedding != row.embedding
                ):
                    continue
                _assign(stored, batch, vector)
                _assign(row, batch, vector)

    def _is_current(self, batch: EmbeddingBatch) -> bool:
        return (
            isinstance(self.embedder, SnapshotEmbeddingAdapter)
            and self.embedder.identity == batch.identity
        )

    async def _embed_many(self, texts: Sequence[str]) -> EmbeddingBatch | None:
        if not isinstance(self.embedder, SnapshotEmbeddingAdapter):
            return None
        try:
            return await self.embedder.embed_batch(texts)
        except Exception as error:
            _logger.warning(
                "memory_embed_failed",
                "本批嵌入未完成",
                reason=type(error).__name__,
                count=len(texts),
            )
            return None


def _ranked(
    rows: Sequence[KnowledgeChunk],
    asked: Sequence[float],
    limit: int,
) -> list[Hit]:
    """按余弦排序取前几条。

    ⚠ 没有向量、或向量与查询不在同一空间的条目排不上——它们等下一次补算；
    不大于 0 的分数也不算命中，否则凑不满 limit 时会拿无关条目充数。

    Args: rows, asked, limit。
    """
    scored: list[tuple[float, KnowledgeChunk]] = []
    for row in rows:
        if row.embedding is None:
            continue
        score = vectors.cosine(asked, vectors.decode(row.embedding))
        if score > 0:
            scored.append((score, row))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [
        Hit(
            id=str(row.id),
            title=row.title,
            body=row.body,
            score=score,
            has_vector=True,
        )
        for score, row in scored[:limit]
    ]
