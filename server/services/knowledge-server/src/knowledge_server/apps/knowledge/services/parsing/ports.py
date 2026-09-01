"""层 2 解析的扩展点：一份原件解成什么。

加一种格式 = 加一个解析器文件 + 注册元组里一行 + 一条契约测试（ADR-0029）。
调用方只认 `ParsedDocument`，不认任何解析器。

⚠ 产出的是**保结构的块序列**，不是一坨字符串（ADR-0033 决策三）。解析器直接
产出「切好的块」的话，「按标题切」这件事会被每个解析器各实现一遍，然后漂成
几种；而只产出纯文本的话，引用指不到页码与行号——那一格丢了之后，后面任何
一层都补不回来。

⚠ **认不出的格式当场抛**，不做「读得动就收」的兜底。兜底的表现是：文档状态
变成 ready 而检索永远查不到它——那与「这份文档里确实没这句话」长得一模一样。
"""

from dataclasses import dataclass, field
from typing import Literal, Protocol, runtime_checkable

# 一个块是什么。⚠ 是闭合集合：切块层按它决定在哪里下刀，认不出的类型会被
# 当成普通段落而丢掉层级信息
BlockKind = Literal["heading", "paragraph", "table_row", "list_item", "caption"]

BLOCK_KINDS: tuple[BlockKind, ...] = (
    "heading",
    "paragraph",
    "table_row",
    "list_item",
    "caption",
)


@dataclass(frozen=True)
class Locator:
    """一个块在原件里的位置。

    ⚠ **不是可选的锦上添花**：解析时丢掉它，后面任何一层都补不回来，而表现是
    答得头头是道却指不出出处——用户没法核对，这份答案就等于没有。

    ⚠ 各格按格式各取所需，用不上的留空：pdf 与 pptx 用 `page`，xlsx 用
    `sheet` + `row`，md 与 docx 用 `path`。硬凑一个统一的「行号」出来，
    会让「第 3 行」在不同格式里指着完全不同的东西。
    """

    # 页码 / 幻灯片序号，从 1 起
    page: int | None = None
    # 工作表名
    sheet: str = ""
    # 表内行号，从 1 起
    row: int | None = None
    # 标题路径，从最外层往里
    path: tuple[str, ...] = ()

    def label(self) -> str:
        """给人看的一句位置。空位置给空串。"""
        parts: list[str] = []
        if self.sheet:
            parts.append(self.sheet)
        if self.page is not None:
            parts.append(f"第 {self.page} 页")
        if self.row is not None:
            parts.append(f"第 {self.row} 行")
        if self.path:
            parts.append(" > ".join(self.path))
        return " · ".join(parts)


@dataclass(frozen=True)
class Block:
    """解析产出的最小单位。"""

    kind: BlockKind
    text: str
    # 标题层级，从 1 起；非标题块是 0
    level: int = 0
    locator: Locator = field(default_factory=Locator)


@dataclass(frozen=True)
class ParsedDocument:
    """一份原件解出来的样子。"""

    title: str
    blocks: tuple[Block, ...]
    # ⚠ 截断了**必须说出来**：悄悄截断的话，后面会把「我看到的就是全部」当成
    # 事实，然后对着半份手册下「这份文档里没有这一节」这种结论
    is_truncated: bool = False


@dataclass(frozen=True)
class RawItem:
    """一份原件：字节 + media type + 文件名。

    ⚠ 刻意**不含「它从哪来」**：解析层不该知道这份字节是用户传的还是从别人
    接口拉的（ADR-0033 决策二）。知道了的话，加一路来源就要改每一个解析器。
    """

    filename: str
    media_type: str
    content: bytes


class UnsupportedRawItem(ValueError):
    """没有哪一路解析器认得这份原件。由注册表翻成一句给用户看的话。"""


@runtime_checkable
class DocumentParser(Protocol):
    """一种格式的解析器。

    ⚠ `suffixes` 与 `media_types` 是**显式白名单**，不做「读得动就收」的兜底。
    """

    @property
    def name(self) -> str:
        """这一路解析器在注册表里的名字。⚠ 这三格声明成只读属性而不是可写
        字段：实现一律是冻结 dataclass，而冻结字段满足不了可写的协议成员。"""
        ...

    @property
    def suffixes(self) -> tuple[str, ...]:
        """认哪些后缀，一律小写带点。"""
        ...

    @property
    def media_types(self) -> tuple[str, ...]:
        """认哪些 media type。"""
        ...

    def parse(self, raw: RawItem) -> ParsedDocument:
        """把一份原件解成保结构的块序列。

        ⚠ 是**同步**的，而且会阻塞：docx/xlsx/pptx 的解析是纯 CPU 的活。
        调用方必须把它扔进进程池——放进事件循环会把整条消费循环连同健康探针
        一起冻住，而现象是「服务好好的，队列不动了」。

        Args: raw。
        """
        ...
