"""几路方言共用的那一段读法：一串「下标 + 分数」的行怎么解成排序结果。

⚠ 共用的只有**这一段**，不是整套方言：路径与请求体各家不同，回包里那串行的
形状却是同一副样子（一个下标、一个分数）。共用它是为了让「加一路方言」只用
写自己不同的那两件事。

⚠ 解不动一律抛 `RerankShapeUnreadable`，绝不跳过读不懂的那几行：跳过的表现是
一次方言配错静默变成「重排把大半候选丢了」，而没有任何一处报错。
"""

from collections.abc import Sequence
from typing import cast

from llmcore.rerank.ports import (
    RerankScore,
    RerankShapeUnreadable,
)


def scores_of_rows(
    rows: object, *, score_keys: Sequence[str], size: int
) -> list[RerankScore]:
    """把一串行解成按分降序的排序结果。

    ⚠ 下标要**落在这一批之内**：端点回一个越界下标时当场抛，而不是让调用方
    拿它去索引一个更短的列表——那是一条 IndexError，而报出来的位置离这里很远。

    Args: rows（回包里那串行）, score_keys（分数落在哪个键上，按序试）,
        size（这一批送出去几条文档）。
    """
    if not isinstance(rows, list):
        raise RerankShapeUnreadable("重排端点没有回一串结果")
    made = [
        _score_of(one, score_keys=score_keys, size=size)
        for one in cast("list[object]", rows)
    ]
    # ⚠ 同一个下标回两次要当场认出来：放过去的话，同一段文字会以两条引用的样子
    # 交出去，而模型会以为它有两个来源
    seen = {one.index for one in made}
    if len(seen) != len(made):
        raise RerankShapeUnreadable("重排端点把同一个下标回了不止一次")
    made.sort(key=lambda one: one.score, reverse=True)
    return made


def _score_of(
    row: object, *, score_keys: Sequence[str], size: int
) -> RerankScore:
    """解一行。

    Args: row, score_keys, size。
    """
    if not isinstance(row, dict):
        raise RerankShapeUnreadable("重排结果里有一行不是对象")
    fields = cast("dict[str, object]", row)
    index = fields.get("index")
    if not isinstance(index, int) or isinstance(index, bool):
        raise RerankShapeUnreadable("重排结果里有一行没有下标")
    if not 0 <= index < size:
        raise RerankShapeUnreadable(f"重排端点回了越界的下标 {index}")
    return RerankScore(index=index, score=_number_of(fields, score_keys))


def _number_of(fields: dict[str, object], keys: Sequence[str]) -> float:
    """按序试几个键取分数；一个都没有就抛。

    Args: fields, keys。
    """
    for key in keys:
        found = fields.get(key)
        if isinstance(found, (int, float)) and not isinstance(found, bool):
            return float(found)
    raise RerankShapeUnreadable("重排结果里有一行没有分数")
