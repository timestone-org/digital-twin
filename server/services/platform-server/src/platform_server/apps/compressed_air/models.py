"""空压机代表工况的数据形状。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Knot:
    """一台机组在代表工况下的流量与主机有功功率。"""

    flow: float
    power: float


type Curves = dict[int, tuple[Knot, ...]]
