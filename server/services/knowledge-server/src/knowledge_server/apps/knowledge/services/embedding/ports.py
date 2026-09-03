"""层 4 嵌入的扩展点：文本怎么变成向量。

⚠ 这一层**可以整个缺席**，而缺席要如实说出来（`can_embed`）。没接嵌入时文档
照常摄取（解析、切块、落块都照做），只是检索回一句「这个库还没建索引」——
**不是**返回空表：空表与「确实没有相关内容」长得一模一样。

⚠ `dimensions` 要如实报：它会跟着每一条向量落库，而库上钉的那一格是「现在用
哪一路」。两者不一致即那条已作废，而不一致的表现只是「召回忽然变差了」。

⚠ `max_input_tokens` 同样不是装饰：**嵌入端点对超出窗口的那一截静默截断、
不报错**。本部署实测 `bge-large-zh-v1.5` 的窗口约 520 个汉字——拿两段只有结尾
不同的长文本量余弦，超过窗口之后余弦恰好等于 1（两条向量逐位相同）。切块层
要拿它当上限，而不是自己定一个常量赌它更窄。
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


class EmbeddingUnavailable(RuntimeError):
    """这套部署没接嵌入档。

    ⚠ 抛而不是回空表：调用方要据它如实告诉用户「这个库还没建索引」。
    """


@runtime_checkable
class Embedder(Protocol):
    """一路嵌入来源。"""

    @property
    def id(self) -> str:
        """这一路的名字。⚠ 会跟着每一条向量落库：换名字会让存量条目看着
        像另一路算的。"""
        ...

    @property
    def dimensions(self) -> int:
        """向量维数。缺席时是 0。"""
        ...

    @property
    def model(self) -> str | None:
        """此刻用的模型名。⚠ 建库时钉在库上：换了模型而名字没跟着变的话，
        旧向量看着像同一路算的。缺席时是 `None`。"""
        ...

    @property
    def max_input_tokens(self) -> int:
        """一次最多吃多少 token，超出的那一截会被端点**静默丢掉**。

        ⚠ 缺席时是 0，而 0 不是「不限」：调用方要把它当成「这套部署此刻算不出
        向量」，与 `can_embed` 同一档处理。
        """
        ...

    @property
    def can_embed(self) -> bool:
        """这一路此刻真能算吗。"""
        ...

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """把一批文本转成向量，顺序与入参一一对应。

        Args: texts。
        """
        ...


@dataclass(frozen=True)
class NullEmbedder:
    """没接嵌入档时的诚实缺席（ADR-0029 决策五）。

    ⚠ 装一个 `Null*` 而不是让调用点写 `if embedder is not None`：那种判断会
    散布到每个调用点，而其中一处漏判的表现是「有时候没建索引」。
    """

    id: str = "none"
    dimensions: int = 0
    model: str | None = None
    max_input_tokens: int = 0
    can_embed: bool = False

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """恒抛：这套部署没接嵌入档。

        Args: texts。
        """
        del texts
        raise EmbeddingUnavailable("这套部署没有接嵌入档")
