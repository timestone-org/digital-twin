"""关键词那一路：`pg_trgm` 的 trigram 相似度。

⚠ 文件叫 `keywords.py` 而不是 `keyword.py`：后者与标准库的 `keyword` 撞名，
以本目录为工作目录跑任何脚本时都会把它顶掉，而报出来的是一串
「circular import in collections」——与关键词检索毫无关系。

⚠ **Postgres 内建分词不切中文**：`to_tsvector('simple', '热水出口温度')` 给出的
是整串一个词，任何一次部分匹配都命不中。所以中文这一侧只能靠 trigram——
代价是索引大，收益是「K1_TMT_HOT」这类编号也搜得到。

⚠ 没有 `ILIKE` 回退档（ADR-0045）：扩展与 GIN 索引都由迁移建，装不上就整栈
起不来。留一条只答「包不包含」、不给分数的回退档，代价是它在界面上与真检索
长得一模一样，而排序能力已经没了。

⚠ 走 `%` 操作符而不是 `similarity(...) > 阈值`：只有前者吃得上 GIN 索引。
后者读起来更直白，但它让每次检索都全表扫描——而那时「装了 pg_trgm」与
「没装」在速度上没有区别。
"""

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.services.indexing.ports import (
    KeywordQuery,
    Scored,
    ranked,
)
from knowledge_server.settings import DB_SCHEMA

TRGM = "trgm"

# ⚠ `similarity()` 与 `%` 都来自 pg_trgm，而它装在**本服务的 schema** 里
# （见那份迁移）：应用连库时 `search_path` 恰好只有这个 schema，所以这里不必
# 也不能给它们加 schema 前缀——操作符加不了前缀，函数加了反而与 `%` 不一致
_TRGM_SEARCH = text(
    # 理由：拼进这段 SQL 的只有 schema 名这个常量，查询串走绑定参数
    "SELECT id, similarity(text, :q) AS score "  # noqa: S608
    f"FROM {DB_SCHEMA}.kb_chunks "
    # ⚠ 这里的 `%` 是 pg_trgm 的相似操作符，**不是**占位符转义：
    # SQLAlchemy 的 `text()` 不做 pyformat 转义（asyncpg 用 $n），写成 `%%`
    # 的话传下去的就是 `%%`，而 Postgres 报的是「operator does not exist」
    "WHERE base_id = :base_id AND text % :q "
    "ORDER BY score DESC LIMIT :limit"
)


@dataclass(frozen=True)
class TrgmKeywordIndex:
    """trigram 相似度。中文英文都认。"""

    name: str = TRGM

    async def search(
        self, session: AsyncSession, query: KeywordQuery
    ) -> list[Scored]:
        """按 trigram 相似度取前几条。

        Args: session, query。
        """
        if not query.text.strip():
            return []
        found = await session.execute(
            _TRGM_SEARCH,
            {
                "q": query.text,
                "base_id": query.base_id,
                "limit": query.limit,
            },
        )
        scored = [
            Scored(
                chunk_id=chunk_id,
                score=float(score),
                why=f"字面相似 {float(score):.3f}",
            )
            for chunk_id, score in found.all()
        ]
        return ranked(scored, query.limit)
