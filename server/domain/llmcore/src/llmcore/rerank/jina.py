"""方言一：`POST {端点根}/rerank`，请求体 `{model, query, documents, top_n}`。

说这套线形的端点是一大把而不是一家：Jina 定的形状，Cohere、TEI、Xinference、
vLLM 的重排端点都照着它。所以这一路按**线形**命名而不是按厂商——按厂商分的话，
接第五家时要再抄一遍同一份实现。

⚠ 分数键收两个：多数端点回 `relevance_score`，TEI 那一路回 `score`。两个都认
不是「放宽」——它们是同一套线形里两个真实存在的写法，只认一个的表现是
「接上了、每次都说读不懂」。

⚠ 结果容器也收两副：多数端点回 `{"results": [...]}`，TEI 直接回一个数组。
"""

from typing import Any, cast

from llmcore.rerank.ports import RerankQuery, RerankScore
from llmcore.rerank.rows import scores_of_rows

DIALECT_JINA = "jina"

# 挂在端点根下的相对路径
PATH = "rerank"
# 分数落在哪个键上，按序试
_SCORE_KEYS = ("relevance_score", "score")


def body_of(ask: RerankQuery) -> dict[str, Any]:
    """拼这一路的请求体。

    Args: ask。
    """
    return {
        "model": ask.model,
        "query": ask.query,
        "documents": list(ask.documents),
        "top_n": ask.top_n,
    }


def scores_of(body: object, size: int) -> list[RerankScore]:
    """解这一路的回包。

    Args: body, size（这一批送出去几条文档）。
    """
    rows = body
    if isinstance(body, dict):
        rows = cast("dict[str, object]", body).get("results")
    return scores_of_rows(rows, score_keys=_SCORE_KEYS, size=size)
