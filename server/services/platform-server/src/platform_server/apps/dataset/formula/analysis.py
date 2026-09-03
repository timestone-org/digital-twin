"""公式引擎眼里的「一个模型」：一个**同步纯计算**的可调用对象。

⚠ 引擎不认识建模模块，只认这两个形状。真实现由建模侧从模型版本编译出来，
经取数相位装进 `externals`（docs/MODELING_DESIGN.md §7.1）。
⚠ 推理路径**不许有任何 I/O**：求值器是纯同步的，一次重算横跨上万行，
每行发一次网络或查一次库就是把整条重算拖垮。
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol, runtime_checkable


@runtime_checkable
class AnalysisModel(Protocol):
    """一个能按实参算出一个数的模型。

    ⚠  不能省：求值器要在运行期分辨「拿到的是模型还是一句
    用不了的原因」，而对普通 Protocol 做 isinstance 会直接抛 TypeError——
    表现是**绑好的模型反而算不出来**。
    """

    def predict(
        self, args: list[float | None], at: datetime | None = None
    ) -> float | None:
        """按位置吃实参，算一个数；算不出来给 None。

        ⚠ `at` 是**这一行的时刻**。带时间特征的模型没有它算不出来，而拿
        「现在」顶替会让同一行在不同时候算出不同的数。
        Args: args, at。
        """
        ...


@dataclass(frozen=True)
class AnalysisUnavailable:
    """这个模型这次用不了，连同一句给最终用户看的原因。

    ⚠ 用不了不是异常，是一句话：拿不到值时那一格空着，但 `compute_error` 上
    要留下人话——「模型未绑定」和「一格莫名其妙的空白」对用户是两回事。
    """

    reason: str


@runtime_checkable
class BatchAnalysisModel(Protocol):
    """整批算得更快的那一类模型。

    ⚠ 与 `AnalysisModel` 分开而不是给它加一个方法：绝大多数模型一行就是几个
    乘加，整批算省不出什么；把「能整批」写进主协议之后，每一个实现都得写一个
    没人受益的分支。
    """

    @property
    def should_batch(self) -> bool:
        """整批算划不划算。不划算就别为它多跑一趟收集相位。"""
        ...

    def predict_many(
        self, rows: list[tuple[list[float | None], datetime | None]]
    ) -> list[float | None]:
        """整批算，结果按传入顺序回。

        Args: rows（每一项是一行的实参与时刻）。
        """
        ...


#: 一次 `PREDICT` 调用的全部输入：公式标识、实参、这一行的时刻
PredictKey = tuple[str, tuple[float | None, ...], datetime | None]


@dataclass
class ModelMemo:
    """`PREDICT` 的结果备忘，外加收集相位记下的待办。

    ⚠ 键是**这次调用的全部输入**，所以它是一份纯函数的记忆——命中与否与行序
    无关。这一点是整个批量相位成立的前提：收集相位按行序走一遍、批量算完，
    真实相位再走一遍时命不中的那些**照样逐行现算**，于是结果与不开批量时
    逐字节相同（docs/MODELING_PLATFORM_DESIGN.md D11b）。
    """

    values: dict[PredictKey, float | None] = field(
        default_factory=dict[PredictKey, float | None]
    )
    #: 收集相位记下、还没算的那些
    requests: list[PredictKey] = field(default_factory=list[PredictKey])
    #: 收集相位里为 True：这时候一律给 None，值等批量算完再说
    is_collecting: bool = True
