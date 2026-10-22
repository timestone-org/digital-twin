"""长期记忆的仓储：写一条、查最像的几条（ADR-0030）。

⚠ **`scope` 与 `owner_id` 的过滤写在这一层**，不写在调用点。这是本模块唯一的
安全条款：助手代表用户行事，绝不能让 A 用户记的东西被 B 检索到。写在调用点的话，
下一个调用点漏掉它不会报错，只会多召回几条别人的。

⚠ 嵌入算不出来时**仍然写入**：存文本、标「没有向量」。丢掉比记不全更坏。补救走
**下一次检索惰性补算**，而不是另建一条关键词召回——两条召回路径意味着两套口径，
迟早给出不同结果，那时「为什么这条查得到那条查不到」没人答得上来。
"""

import time
from collections.abc import Callable, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.models import KnowledgeChunk
from ai_assistant.apps.chat.services.memory.ports import (
    Hit,
    Knowledge,
    Remembered,
    Scope,
)
from ai_assistant.llm import EmbeddingAdapter
from lib import vectors
from lib.errors import DependencyUnavailable
from lib.logging import get_logger
from llmcore.embedding_snapshot import EmbeddingBatch

_logger = get_logger("assistant.memory")

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# 一次检索最多惰性补算几条。⚠ 有上限：一次「查一下」不该顺手变成几百次嵌入调用，
# 那会让第一次检索慢到看着像挂了。补不完的下次接着补
MAX_BACKFILL = 20
# 一次最多取回多少条来算余弦。⚠ 有上限：应用层检索的代价随条目数线性涨，
# 而这一档是 ADR-0030 里那条「什么时候该换 pgvector」的触发点
MAX_SCANNED = 2000


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
        return self.embedder is not None and self.embedder.is_ready

    async def remember(self, item: Knowledge) -> Remembered:
        """记一条，回它的 id。

        Args: item。
        """
        batch = await self._embed_many([f"{item.title}\n{item.body}"])
        vector = None if batch is None else batch.vectors[0]
        row = KnowledgeChunk(
            scope=item.scope,
            owner_id=item.owner_id,
            title=item.title,
            body=item.body,
            embedding=None if vector is None else vectors.encode(vector),
            embedding_model=None if batch is None else batch.identity,
            dimensions=None if vector is None else len(vector),
        )
        async with self.sessions() as session:
            session.add(row)
            # ⚠ flush 不 commit：事务由这一层的上下文管理器收口，
            # 提前 commit 取 id 会把一次写拆成两段（database-standard）
            await session.flush()
            return Remembered(
                id=str(row.id),
                is_searchable=batch is not None
                and batch.identity == self._model_id(),
            )

    async def search(
        self, query: str, scope: Scope, owner_id: str, limit: int
    ) -> list[Hit]:
        """查最像的几条。

        Args: query, scope, owner_id, limit。
        """
        started = time.monotonic()
        batch = await self._embed_many([query])
        if batch is None:
            if self.can_rank:
                raise DependencyUnavailable(
                    "长期记忆嵌入请求失败，本次没有完成检索"
                )
            return []
        model = batch.identity
        rows = await self._rows_of(scope, owner_id)
        await self._backfill(rows, model)
        if self._model_id() != model:
            raise DependencyUnavailable(
                "记忆检索期间嵌入模型发生变化，请重新查询"
            )
        found = _ranked(rows, batch.vectors[0], limit, model)
        # 耗时指标。⚠ 标签只有 scope——低基数（observability）；owner_id 进去
        # 就是每个用户一条时间序列，那会把指标后端撑爆
        _logger.info(
            "memory_search",
            "一次长期记忆检索",
            scope=scope,
            scanned=len(rows),
            hits=len(found),
            elapsed_ms=round((time.monotonic() - started) * 1000),
        )
        return found

    async def _rows_of(
        self, scope: Scope, owner_id: str
    ) -> list[KnowledgeChunk]:
        async with self.sessions() as session:
            found = await session.execute(
                select(KnowledgeChunk)
                .where(KnowledgeChunk.scope == scope)
                .where(KnowledgeChunk.owner_id == owner_id)
                .order_by(KnowledgeChunk.created_at.desc())
                .limit(MAX_SCANNED)
            )
            return list(found.scalars().all())

    async def _backfill(
        self, rows: Sequence[KnowledgeChunk], model: str
    ) -> None:
        """给当时没算出向量的那几条补上，就地写回。

        Args: rows。
        """
        if self._model_id() != model:
            raise DependencyUnavailable("嵌入模型已变化，请重新检索")
        pending = [
            one
            for one in rows
            if one.embedding is None or one.embedding_model != model
        ][:MAX_BACKFILL]
        if not pending or self.embedder is None:
            return
        made = await self._embed_many(
            [f"{one.title}\n{one.body}" for one in pending]
        )
        if made is None:
            raise DependencyUnavailable("长期记忆补算失败，本次检索尚未完成")
        if made.identity != model:
            raise DependencyUnavailable("嵌入模型已变化，请重新检索")
        async with self.sessions() as session:
            for row, vector in zip(pending, made.vectors, strict=True):
                stored = await session.get(KnowledgeChunk, row.id)
                if stored is None:
                    continue
                stored.embedding = vectors.encode(vector)
                stored.embedding_model = model
                stored.dimensions = len(vector)
                # 就地也更新手上这一份，本次检索就能把它排进去
                row.embedding = stored.embedding
                row.dimensions = stored.dimensions
                row.embedding_model = stored.embedding_model

    def _model_id(self) -> str | None:
        if self.embedder is None:
            return None
        return self.embedder.identity

    async def _embed_many(self, texts: Sequence[str]) -> EmbeddingBatch | None:
        """算一批向量；没接嵌入档或这次算不出来给 `None`。

        ⚠ 吞掉异常是刻意的：嵌入算不出来该退化成「这条暂时检索不到」，
        而不是让一次 `remember` 整个失败——用户说的那句话就此丢了。

        Args: texts。
        """
        if self.embedder is None:
            return None
        try:
            return await self.embedder.embed_batch(texts)
        except Exception as error:  # 理由：见上
            _logger.warning(
                "memory_embed_failed",
                "嵌入算不出来，这一批条目暂时检索不到",
                reason=type(error).__name__,
                count=len(texts),
            )
            return None


def _ranked(
    rows: Sequence[KnowledgeChunk],
    asked: Sequence[float],
    limit: int,
    model: str | None,
) -> list[Hit]:
    """按余弦排序取前几条。没有向量的条目排不上——它们等下一次补算。"""
    scored: list[tuple[float, KnowledgeChunk]] = []
    for row in rows:
        if (
            row.embedding is None
            or row.embedding_model != model
            or row.dimensions != len(asked)
        ):
            continue
        scored.append(
            (vectors.cosine(asked, vectors.decode(row.embedding)), row)
        )
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
