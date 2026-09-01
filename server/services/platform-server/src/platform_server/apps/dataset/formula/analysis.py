"""公式引擎眼里的「一个模型」：一个**同步纯计算**的可调用对象。

⚠ 引擎不认识建模模块，只认这两个形状。真实现由建模侧从模型版本编译出来，
经取数相位装进 `externals`（docs/MODELING_DESIGN.md §7.1）。
⚠ 推理路径**不许有任何 I/O**：求值器是纯同步的，一次重算横跨上万行，
每行发一次网络或查一次库就是把整条重算拖垮。
"""

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@runtime_checkable
class AnalysisModel(Protocol):
    """一个能按实参算出一个数的模型。

    ⚠  不能省：求值器要在运行期分辨「拿到的是模型还是一句
    用不了的原因」，而对普通 Protocol 做 isinstance 会直接抛 TypeError——
    表现是**绑好的模型反而算不出来**。
    """

    def predict(self, args: list[float | None]) -> float | None:
        """按位置吃实参，算一个数；算不出来给 None。

        Args: args。
        """
        ...


@dataclass(frozen=True)
class AnalysisUnavailable:
    """这个模型这次用不了，连同一句给最终用户看的原因。

    ⚠ 用不了不是异常，是一句话：拿不到值时那一格空着，但 `compute_error` 上
    要留下人话——「模型未绑定」和「一格莫名其妙的空白」对用户是两回事。
    """

    reason: str
