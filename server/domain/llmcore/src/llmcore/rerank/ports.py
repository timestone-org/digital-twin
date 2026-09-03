"""重排的扩展点：一批候选按与问题的相关度重新排一次序。

⚠ 与嵌入分开而不是当成它的又一档：嵌入是**每条文档各算一个向量**且要落库对账，
重排是**一次调用里 query 与整批文档一起打分**且什么都不落。混成一档的直接后果
是换一路重排模型会被当成换了嵌入模型，于是整库向量作废——而它们其实毫无关系。

⚠ 打分**只排序不取舍**：得分为 0 的候选一律不返回。硬凑几条出来的话，调用方
会以为「就这些了」然后从里面挑一条，那比拿到空表难查得多。

⚠ 缺席要如实说（`is_ready`），不许悄悄退化：没接重排时调用方该退回融合名次
并标注这次没重排，而不是让整次检索塌掉。
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from llmcore.errors import ModelDisabled


class RerankUnavailable(ModelDisabled):
    """这套部署没接重排档。

    ⚠ 抛而不是回空表：回空表的话，调用方会把「没接重排」读成「一条都不相关」，
    于是把一批本来有用的候选整个丢掉。

    ⚠ 承 `ModelDisabled` 而不是另起一支：它与「没接嵌入档」是同一件事的两个
    位置，共用 503 与不可重试这两条判定——另起一支的话，某个调用点漏接一支就
    把一句「本部署没接」变成一条 500。
    """

    code = 52205


@dataclass(frozen=True)
class RerankScore:
    """一条候选重排之后拿到的分。"""

    # 入参那一批文档里的下标。⚠ 回下标而不是回文档原文：回原文的话调用方要拿
    # 字符串去反查是哪一条，而重复文本会匹配到错的那一条，且看着完全正常
    index: int
    score: float


class RerankShapeUnreadable(ValueError):
    """端点回来的东西按这一路方言解不动。

    ⚠ 按「我们发错了」处理而不是「下游此刻不行」：解不动几乎总是方言配错了
    （拿一路的形状去读另一路的回包），重试一万次也一样。当成下游故障的话，
    断路器一开，真正的原因就被盖成「暂时不可用」，而那会让人去查网络。
    """


@dataclass(frozen=True)
class RerankQuery:
    """一次重排要问的东西，方言据它拼请求体。"""

    model: str
    query: str
    documents: tuple[str, ...]
    top_n: int


@dataclass(frozen=True)
class RerankDialect:
    """一套重排线形：打端点根下的哪个路径、请求体长什么样、回包怎么读。

    ⚠ 方言是**线形**不是厂商：一套线形往往有一大把端点在说它（Jina 那一套
    Cohere / TEI / Xinference / vLLM 都在用）。按厂商分的话，接第五家时要
    再抄一遍同一份实现。
    """

    code: str
    # 挂在端点根下的相对路径，形如 `rerank`
    path: str
    body_of: Callable[[RerankQuery], dict[str, Any]]
    # 收（回包, 这一批送出去几条），解不动时抛 `RerankShapeUnreadable`。
    # ⚠ 批量要传进去：端点回一个越界下标时得当场认出来，交给调用方的话，
    # 那是一条 IndexError，而报出来的位置离方言很远
    scores_of: Callable[[object, int], list[RerankScore]]


@runtime_checkable
class Reranker(Protocol):
    """一路重排来源。"""

    @property
    def id(self) -> str:
        """这一路的名字。⚠ 声明成只读属性而不是可写字段：实现一律是冻结
        dataclass，而冻结字段满足不了一个可写的协议成员。"""
        ...

    @property
    def is_ready(self) -> bool:
        """此刻真能排吗。

        ⚠ 端点来自运行期可改的目录时它会变：装配了不等于能排。
        """
        ...

    @property
    def model(self) -> str | None:
        """此刻用的模型名；没接时是 `None`。"""
        ...

    async def rerank(
        self, query: str, documents: Sequence[str], *, top_n: int
    ) -> list[RerankScore]:
        """把一批文档按与问题的相关度重排，按分**降序**给回下标与分数。

        Args: query, documents, top_n（最多要几条）。
        """
        ...
