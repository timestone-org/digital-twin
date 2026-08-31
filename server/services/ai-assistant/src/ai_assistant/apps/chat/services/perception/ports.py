"""层 1 感知输入的扩展点：一种输入怎么被解成模型看得懂的东西。

加一种格式 = 加一个解码器文件 + 注册表里一行 + 一条契约测试（ADR-0029）。

⚠ 解出来分两态，而两态的差别**决定这一轮走哪一档模型**：`AsText` 进对话正文走
对话档，`AsImage` 进图片块走视觉档（单价与延迟都高得多）。判错的表现不是报错，
是账单——每次闲聊都按视觉计费。

⚠ 截断了**必须说出来**（`is_truncated`）。悄悄截断的话，模型会把「我看到的就是
全部」当成事实，然后对着半张点表下「这个数据源里没有温度点位」这种结论。
"""

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class AsText:
    """解成一段正文，直接进对话。表格摊成竖线表，纯文本原样截取。"""

    text: str
    is_truncated: bool
    # 给人看的一句概况（「12 列 × 200 行，已截断」）。进不了模型上下文，只上界面
    summary: str = ""


@dataclass(frozen=True)
class AsImage:
    """解成一张图，进视觉档的图片块。

    ⚠ `data_uri` 里是完整的 `data:image/...;base64,...`。图**不落库**，
    落的是一句占位——一张图几兆字节，存进去之后这个会话每重放一次就再喂一遍。
    """

    data_uri: str
    media_type: str


Decoded = AsText | AsImage


class UnsupportedInput(ValueError):
    """这一路解码器不认这份输入。由注册表翻成一句给用户看的话。"""


@runtime_checkable
class InputDecoder(Protocol):
    """一种输入的解码器。

    ⚠ `suffixes` 与 `media_types` 是**显式白名单**，不做「读得动就收」的兜底：
    兜底会把 pdf、二进制、svg 这些放进来——前两者解出一堆乱码占满上下文，
    svg 还能内嵌脚本，而界面要给用户看一张缩略图。
    """

    name: str
    suffixes: tuple[str, ...]
    media_types: tuple[str, ...]

    def decode(self, raw: bytes, filename: str) -> Decoded:
        """把一份原始输入解成模型看得懂的东西。

        Args: raw, filename（判类型用，也进给模型的正文里——不说清文件名，
            模型不知道自己在看什么）。
        """
        ...
