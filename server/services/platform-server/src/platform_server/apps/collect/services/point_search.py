"""当前用户权限内的点位混合搜索；模型故障明确退回关键词。"""

import uuid
from dataclasses import dataclass

from lib.crypto import SecretCipher
from lib.logging import get_logger
from platform_server.apps.collect.crud import point_semantic
from platform_server.apps.collect.errors import PointSearchTimedOut
from platform_server.apps.collect.schemas.point_search import (
    PointMatchesOut,
    PointMatchOut,
)
from platform_server.apps.collect.services.point_embedding import (
    PointSessions,
    embed_texts,
    load_profile,
)

_logger = get_logger("platform.collect.search")


@dataclass(frozen=True)
class PointSearch:
    """平台搜索所需的短事务与嵌入档读取面。"""

    database: PointSessions
    cipher: SecretCipher | None

    async def search(
        self, query: str, source_id: uuid.UUID | None, limit: int
    ) -> PointMatchesOut:
        """查候选并说明是否退化。Args: query, source_id, limit。"""
        profile = await load_profile(self.database, self.cipher)
        note = (
            "未分配知识库嵌入模型，本次仅按关键词查找"
            if profile is None
            else None
        )
        probe: list[float] | None = None
        if profile is not None:
            try:
                probe = (await embed_texts(profile, [query]))[0]
            except Exception as error:
                _logger.warning(
                    "point_search_embedding_failed",
                    "语义搜索暂不可用",
                    error_type=type(error).__name__,
                )
                note = "语义检索暂不可用，本次仅按关键词查找"
        parameters: point_semantic.PointSearchParameters = {
            "query": query,
            "source_id": source_id,
            "limit": limit,
            "signature": profile.signature if profile else "",
            "probe": probe,
        }
        rows, pending_count, degraded = await self._search(parameters)
        if degraded:
            note = "语义检索超时，本次仅按关键词查找"
        if note is None and pending_count:
            note = (
                f"有 {pending_count} 个点位正在等待语义索引，仍参与关键词匹配"
            )
        return PointMatchesOut(
            items=[PointMatchOut.model_validate(row) for row in rows],
            mode="hybrid" if probe is not None and not degraded else "keyword",
            pending_count=pending_count,
            note=note,
        )

    async def _search(
        self, parameters: point_semantic.PointSearchParameters
    ) -> tuple[list[dict[str, object]], int, bool]:
        try:
            rows, pending = await self._query(parameters)
            return rows, pending, False
        except PointSearchTimedOut:
            if parameters["probe"] is None:
                raise
        _logger.warning(
            "point_search_query_timed_out",
            "语义检索超时，转为关键词检索",
        )
        # ⚠ 失败事务已退出并回滚；降级必须使用新会话。
        rows, pending = await self._query({**parameters, "probe": None})
        return rows, pending, True

    async def _query(
        self, parameters: point_semantic.PointSearchParameters
    ) -> tuple[list[dict[str, object]], int]:
        async with self.database.session() as session:
            return await point_semantic.search(session, parameters)
