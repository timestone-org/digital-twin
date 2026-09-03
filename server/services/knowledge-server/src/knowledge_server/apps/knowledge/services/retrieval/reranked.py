"""策略怎么用重排那一层：多召一批、重排、按新分截断。

⚠ 这一步**只换名次不换集合边界之外的东西**：候选仍然来自召回，重排只决定
留下哪几条、按什么顺序。它不去补检、也不放宽过滤。

⚠ 排不成时退回融合名次并把这件事写进 `note`：重排是排序增强，它挂了不该让
用户拿到一句「检索失败」，而资料明明查得到。反过来，**不标注**才是那条真正
的坑——那时质量忽然变了，却没有任何一处报错。

⚠ 没接重排时不写 `note`：那是这套部署的常态而不是这一次的意外，说它一遍就够，
说的地方是 `/capabilities`。每次检索都念一句的话，真正的失败反而被淹掉。
"""

from collections.abc import Sequence
from dataclasses import replace

from knowledge_server.apps.knowledge.services.reranking import (
    Reranker,
    RerankFailed,
)
from knowledge_server.apps.knowledge.services.retrieval.ports import Hit
from lib.logging import get_logger

_logger = get_logger("knowledge.rerank")

# 送去重排的候选 = 要几条 × 这个倍数。⚠ 比最终 limit 大一截才有得可排：
# 只送 limit 条的话，重排能做的只有把这几条换个顺序，而它真正的价值是把
# 融合名次里排在 limit 之外、其实最相关的那一条捞上来
RERANK_WIDEN = 3
# 一次重排最多送几条。⚠ 有上限：每条候选的**全文**都要随请求发出去，一段块
# 按 800 字算，60 条就是四万多字——再宽下去是一次必然超限的调用，而延迟也是
# 随批量线性涨的
RERANK_MAX_CANDIDATES = 60

RERANK_FAILED_NOTE = "重排这一步没做成，本次按融合名次给出"


def candidate_width(limit: int) -> int:
    """这一次要召多少条候选送去重排。

    Args: limit（最终要几条）。
    """
    return min(limit * RERANK_WIDEN, RERANK_MAX_CANDIDATES)


async def reranked(
    reranker: Reranker, query: str, hits: Sequence[Hit], limit: int
) -> tuple[tuple[Hit, ...], str]:
    """把一批候选重排后截断，并回一句「这次出了什么事」。

    ⚠ 得分为 0 的候选**不返回**（KNOWLEDGE_BASE_DESIGN §1.3）：硬凑几条出来的
    话，调用方会以为「就这些了」然后从里面挑一条，那比拿到空表难查得多。

    Args: reranker, query, hits（融合名次序）, limit。
    """
    rows = tuple(hits)
    if not reranker.can_rerank or not rows:
        return (rows[:limit], "")
    try:
        scored = await reranker.rerank(
            query, [one.text for one in rows], top_n=limit
        )
    except RerankFailed as error:
        _logger.warning(
            "knowledge_rerank_skipped",
            "重排没做成，本次按融合名次给出",
            reason=str(error),
        )
        return (rows[:limit], RERANK_FAILED_NOTE)
    made = [
        replace(
            rows[one.index],
            score=one.score,
            why=f"{rows[one.index].why}；重排 {one.score:.4f}",
        )
        for one in scored
        if one.score > 0
    ]
    return (tuple(made[:limit]), "")
