"""关键词那两路：`pg_trgm` 与 `ILIKE`。

⚠ 文件叫 `keywords.py` 而不是 `keyword.py`：后者与标准库的 `keyword` 撞名，
以本目录为工作目录跑任何脚本时都会把它顶掉，而报出来的是一串
「circular import in collections」——与关键词检索毫无关系。

⚠ **Postgres 内建分词不切中文**：`to_tsvector('simple', '热水出口温度')` 给出的
是整串一个词，任何一次部分匹配都命不中。所以中文这一侧只能靠 trigram——
代价是索引大，收益是「K1_TMT_HOT」这类编号也搜得到。

⚠ 回退档（`ILIKE`）是**全表扫描**，而且它只答「包不包含」不给分数。留着它是
为了「装不上 pg_trgm 的库仍然能用关键词」，不是为了当默认。

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
LIKE = "like"

# ⚠ `similarity()` 要 pg_trgm 装上才有。装没装由启动探测说了算，
# 这条 SQL 只在探测到之后才会被跑到
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

# ⚠ 回退档给的是**固定分**：`ILIKE` 只答包不包含。给一个假的浮点分数会让
# 融合那一层以为它排过序，而它没有
_LIKE_SEARCH = text(
    # 理由：同上
    "SELECT id FROM " + DB_SCHEMA + ".kb_chunks "  # noqa: S608
    "WHERE base_id = :base_id AND text ILIKE :pattern "
    "ORDER BY ordinal LIMIT :limit"
)

# 回退档命中时给的分。⚠ 取一个明显低于向量档的值：它没有排序能力，
# 排在向量档前面会把好结果挤掉
LIKE_SCORE = 0.3


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


@dataclass(frozen=True)
class LikeKeywordIndex:
    """`ILIKE` 包含匹配。装不上 pg_trgm 时的回退档。"""

    name: str = LIKE

    async def search(
        self, session: AsyncSession, query: KeywordQuery
    ) -> list[Scored]:
        """按包含匹配取前几条，分数固定。

        Args: session, query。
        """
        wanted = query.text.strip()
        if not wanted:
            return []
        found = await session.execute(
            _LIKE_SEARCH,
            {
                "pattern": f"%{wanted}%",
                "base_id": query.base_id,
                "limit": query.limit,
            },
        )
        return [
            Scored(
                chunk_id=row[0],
                score=LIKE_SCORE,
                why="字面包含（这套部署没装 pg_trgm，排不出先后）",
            )
            for row in found.all()
        ]
