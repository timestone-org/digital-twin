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
from ai_assistant.apps.chat.services.memory.ports import Hit, Knowledge, Scope
from ai_assistant.llm import EmbeddingAdapter
from lib import vectors
from lib.logging import get_logger

_logger = get_logger("assistant.memory")

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# 一次检索最多惰性补算几条。⚠ 有上限：一次「查一下」不该顺手变成几百次嵌入调用，
# 那会让第一次检索慢到看着像挂了。补不完的下次接着补
MAX_BACKFILL = 20
# 一次最多取回多少条来算余弦。⚠ 有上限：应用层检索的代价随条目数线性涨，
# 而这一档是 ADR-0030 里那条「什么时候该换 pgvector」的触发点
MAX_SCANNED = 2000


@dataclass(frozen=True)
class _Space:
    """一次查询所在的向量空间：哪个模型、几维。"""

    model: str | None
    dimensions: int

    def holds(self, row: KnowledgeChunk) -> bool:
        """这一行的向量是不是在这个空间里算的。Args: row。"""
        return (
            row.embedding is not None
            and row.embedding_model == self.model
            and row.dimensions == self.dimensions
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
        return self.embedder is not None and self.embedder.is_ready

    async def remember(self, item: Knowledge) -> str:
        """记一条，回它的 id。

        Args: item。
        """
        vector = await self._embed(f"{item.title}\n{item.body}")
        row = KnowledgeChunk(
            scope=item.scope,
            owner_id=item.owner_id,
            title=item.title,
            body=item.body,
            embedding=None if vector is None else vectors.encode(vector),
            embedding_model=None if vector is None else self._model_id(),
            dimensions=None if vector is None else len(vector),
        )
        async with self.sessions() as session:
            session.add(row)
            # ⚠ flush 不 commit：事务由这一层的上下文管理器收口，
            # 提前 commit 取 id 会把一次写拆成两段（database-standard）
            await session.flush()
            return str(row.id)

    async def search(
        self, query: str, scope: Scope, owner_id: str, limit: int
    ) -> list[Hit]:
        """查最像的几条。

        Args: query, scope, owner_id, limit。
        """
        started = time.monotonic()
        asked = await self._embed(query)
        if asked is None:
            return []
        rows = await self._rows_of(scope, owner_id)
        space = _Space(model=self._model_id(), dimensions=len(asked))
        await self._backfill(rows, space)
        found = _ranked(rows, asked, limit, self._comparable(space))
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
        self, rows: Sequence[KnowledgeChunk], space: _Space
    ) -> None:
        """给没算出向量、或向量不在当前空间里的那几条重算，就地写回。

        Args: rows, space（这一次查询的模型与维数）。
        """
        pending = [one for one in rows if not space.holds(one)][:MAX_BACKFILL]
        if not pending or self.embedder is None:
            return
        made = await self._embed_many(
            [f"{one.title}\n{one.body}" for one in pending]
        )
        if made is None:
            return
        model = self._model_id()
        async with self.sessions() as session:
            for row, vector in zip(pending, made, strict=True):
                stored = await session.get(KnowledgeChunk, row.id)
                if stored is None:
                    continue
                stored.embedding = vectors.encode(vector)
                stored.embedding_model = model
                stored.dimensions = len(vector)
                # 就地也更新手上这一份，本次检索就能把它排进去
                row.embedding = stored.embedding
                row.embedding_model = stored.embedding_model
                row.dimensions = stored.dimensions

    def _model_id(self) -> str | None:
        """落库的模型名：此刻端点上的模型，解不出时退回来源名。

        ⚠ 记来源名（`openai-compat`）的话，目录里换了同维数的模型也看不出来，
        旧向量会与新查询算余弦。
        """
        if self.embedder is None:
            return None
        return self.embedder.model or self.embedder.id

    def _comparable(self, space: _Space) -> Callable[[KnowledgeChunk], bool]:
        """哪些行的向量能与这一次查询比。

        ⚠ 只记了来源名的存量行照常参与排序、同时惰性重算：不参与的话，升级后
        这些记忆要等补完才查得到，而一次只补 MAX_BACKFILL 条。

        Args: space。
        """
        legacy = None if self.embedder is None else self.embedder.id

        def comparable(row: KnowledgeChunk) -> bool:
            return row.dimensions == space.dimensions and (
                row.embedding_model in (space.model, legacy)
            )

        return comparable

    async def _embed(self, text: str) -> list[float] | None:
        made = await self._embed_many([text])
        return None if made is None else made[0]

    async def _embed_many(
        self, texts: Sequence[str]
    ) -> list[list[float]] | None:
        """算一批向量；没接嵌入档或这次算不出来给 `None`。

        ⚠ 吞掉异常是刻意的：嵌入算不出来该退化成「这条暂时检索不到」，
        而不是让一次 `remember` 整个失败——用户说的那句话就此丢了。

        Args: texts。
        """
        if self.embedder is None:
            return None
        try:
            return await self.embedder.embed(texts)
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
    comparable: Callable[[KnowledgeChunk], bool],
) -> list[Hit]:
    """按余弦排序取前几条。

    ⚠ 没有向量、或向量与查询不在同一空间的条目排不上——它们等下一次补算；
    不大于 0 的分数也不算命中，否则凑不满 limit 时会拿无关条目充数。

    Args: rows, asked, limit, comparable。
    """
    scored: list[tuple[float, KnowledgeChunk]] = []
    for row in rows:
        if row.embedding is None or not comparable(row):
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
