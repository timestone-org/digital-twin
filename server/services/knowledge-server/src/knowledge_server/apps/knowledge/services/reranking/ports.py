"""层 7 重排的扩展点：召回之后按与问题的相关度重排一次（ADR-0042）。

⚠ 这一层**可以整个缺席**，而缺席要如实说出来（`can_rerank`）。没接重排时检索
照常返回融合名次——那是基线，不是「坏了」；缺席由 `/capabilities` 如实回答，
不靠每一次检索各说一遍。

⚠ 与嵌入层分开而不是并进去：嵌入的产物**要落库对账**（换模型即整库作废），
重排什么都不落。混成一层的话，「换重排模型」会被当成「换嵌入模型」，
而那句话的代价是一次全库重建。

⚠ 重排失败**不许把整次检索带塌**：它是排序增强，挂了就退回融合名次并如实
标注这次没重排。让它抛穿的表现是用户拿到一句「检索失败」，而资料明明查得到。
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from llmcore.rerank import RerankScore


class RerankFailed(RuntimeError):
    """这一次没排成（没接、端点拒了、或方言这一侧没装）。

    ⚠ 三种情形共用一个类型是刻意的：调用方对它们的处置**完全一样**——退回融合
    名次。分成三支只会让某个调用点漏接一支，而漏接的那一支会把整次检索带塌。
    """


@runtime_checkable
class Reranker(Protocol):
    """一路重排来源。"""

    @property
    def id(self) -> str:
        """这一路的名字。⚠ 声明成只读属性而不是可写字段：实现一律是冻结
        dataclass，而冻结字段满足不了一个可写的协议成员。"""
        ...

    @property
    def model(self) -> str | None:
        """此刻用的模型名；没接时是 `None`。"""
        ...

    @property
    def can_rerank(self) -> bool:
        """这一路此刻真能排吗。"""
        ...

    @property
    def is_failing(self) -> bool:
        """这一路此刻**接着却排不成**吗（断路器不是关着的）。

        ⚠ 与 `can_rerank` 是两件事，而混成一件正是那个静默退化的来路：
        「解得出端点」不等于「那个端点会应答」。实测过一次——端点接了、
        `/v1/models` 秒回、`/v1/rerank` 挂住不回，于是每次检索先等满超时，
        而 `/capabilities` 报的是「接了、一切正常」。
        """
        ...

    async def rerank(
        self, query: str, documents: Sequence[str], *, top_n: int
    ) -> list[RerankScore]:
        """把一批文档按相关度重排，按分降序给回原下标与分数。

        排不成时抛 `RerankFailed`。

        Args: query, documents, top_n。
        """
        ...


@dataclass(frozen=True)
class NullReranker:
    """没接重排档时的诚实缺席（ADR-0029 决策五）。

    ⚠ 装一个 `Null*` 而不是让调用点写 `if reranker is not None`：那种判断会
    散布到每个策略里，而其中一处漏判的表现是「有的策略排了、有的没排」。
    """

    id: str = "none"
    model: str | None = None
    can_rerank: bool = False
    # ⚠ 没接不算「正在失败」：那是这套部署的常态，而 `reason` 里说的是
    # 「没接」；两者混成一句会让运维去查一个根本没配过的端点
    is_failing: bool = False

    async def rerank(
        self, query: str, documents: Sequence[str], *, top_n: int
    ) -> list[RerankScore]:
        """恒抛：这套部署没接重排档。

        Args: query, documents, top_n。
        """
        del query, documents, top_n
        raise RerankFailed("这套部署没有接重排档")
