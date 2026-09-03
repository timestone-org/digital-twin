"""方言二：原生 text-rerank 那一套，请求体分 `input` 与 `parameters` 两段。

⚠ 这一路的端点根**不是** OpenAI 兼容那一个：兼容口径下根本没有重排这件事，
它挂在原生面 `.../api/v1` 底下。故要用它就在目录里单独建一路供应商，
端点填原生面的根——「档位即供应商」（ADR-0040）本来就是这么用的。

⚠ 回包多包一层 `output`：拿另一路方言去读它会解出空结果，而空结果与
「一条都不相关」长得一模一样。故解不动一律抛，不返回空表。
"""

from typing import Any, cast

from llmcore.rerank.ports import RerankQuery, RerankScore
from llmcore.rerank.rows import scores_of_rows

DIALECT_DASHSCOPE = "dashscope"

# 挂在原生面端点根下的相对路径
PATH = "services/rerank/text-rerank/text-rerank"
_SCORE_KEYS = ("relevance_score",)


def body_of(ask: RerankQuery) -> dict[str, Any]:
    """拼这一路的请求体。

    ⚠ `return_documents` 关掉：原文是我们自己送过去的，让端点再抄回来一遍
    只是把回包撑大一倍，而我们只拿下标。

    Args: ask。
    """
    return {
        "model": ask.model,
        "input": {"query": ask.query, "documents": list(ask.documents)},
        "parameters": {"top_n": ask.top_n, "return_documents": False},
    }


def scores_of(body: object, size: int) -> list[RerankScore]:
    """解这一路的回包。

    Args: body, size（这一批送出去几条文档）。
    """
    if not isinstance(body, dict):
        return scores_of_rows(None, score_keys=_SCORE_KEYS, size=size)
    output = cast("dict[str, object]", body).get("output")
    rows = (
        cast("dict[str, object]", output).get("results")
        if isinstance(output, dict)
        else None
    )
    return scores_of_rows(rows, score_keys=_SCORE_KEYS, size=size)
