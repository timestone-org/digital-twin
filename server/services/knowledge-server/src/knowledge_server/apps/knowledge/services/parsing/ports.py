"""层 2 解析的扩展点：一份原件解成什么，以及由**哪一路后端**去解。

两级扩展点（ADR-0043）：

- `ParserBackend` 是「谁来解」——一期两类，本地库解（`DocumentParser`）与
  外部服务解（`ExternalParserBackend`，只有端口，没有实现）。
- 每一路后端自己声明认哪些后缀与 media type。

加一种格式 = 加一个解析器文件 + 注册元组里一行 + 一条契约测试（ADR-0029）。
调用方只认 `ParsedDocument`，不认任何后端。

⚠ 两类后端**产出同一个 `ParsedDocument`**（`Block` + 必填 `locator`）。外部
服务回的多半是 markdown + 版面 JSON，那一步翻译由那一路后端的实现自己做完，
不许把产出放宽成一坨字符串——放宽了的话，「换一个后端」就会连着改切块层。

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
BlockKind = Literal[
    "heading", "paragraph", "table_row", "list_item", "caption", "figure"
]

BLOCK_KINDS: tuple[BlockKind, ...] = (
    "heading",
    "paragraph",
    "table_row",
    "list_item",
    "caption",
    "figure",
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

    # 页码 / 幻灯片序号，从 1 起。一块横跨几页时这是**起页**
    page: int | None = None
    # 止页。⚠ 与 `page` 不同才有意义：一块攒了好几页的内容时，只报起页的引用
    # 会让人翻到第 4 页却找不到那句话——它在第 6 页。同页时留空
    page_end: int | None = None
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
            parts.append(f"第 {self._pages()} 页")
        if self.row is not None:
            parts.append(f"第 {self.row} 行")
        if self.path:
            parts.append(" > ".join(self.path))
        return " · ".join(parts)

    def _pages(self) -> str:
        """一页写「4」，跨页写「4–6」。"""
        if self.page_end is None or self.page_end <= (self.page or 0):
            return str(self.page)
        return f"{self.page}–{self.page_end}"


@dataclass(frozen=True)
class Block:
    """解析产出的最小单位。"""

    kind: BlockKind
    text: str
    # 标题层级 / 列表项的嵌套深度，都从 1 起；两者都不是的块是 0。
    # ⚠ 一格两义靠 `kind` 分辨：标题与列表项各只用得上其中一种深度，
    # 而各开一格会让每个解析器都要决定另一格填什么
    level: int = 0
    locator: Locator = field(default_factory=Locator)
    # `kind == "figure"` 的块指向 `ParsedDocument.figures` 里哪一张。
    # ⚠ 别的 kind 一律空串：这一格一有值就意味着「这一块的正文里出现了那张
    # 图」，而块与图的关系正是靠它连起来的
    figure_ref: str = ""


@dataclass(frozen=True)
class Figure:
    """解析出来的一张图（插图或表格截图）连它的字节。

    ⚠ 字节跟着解析结果一起交出来，而不是让调用方拿 `ref` 再去问一次后端：
    外部后端那一路是一次网络调用换一份产出，回头再问一次等于再解析一遍。

    ⚠ `ref` 只在这一份产出内部有意义，不落库：落库的是内容哈希算出来的
    对象键。后端换一路，`ref` 的形状就变了。
    """

    ref: str
    content: bytes
    media_type: str
    kind: Literal["image", "table"] = "image"
    page: int | None = None
    caption: str = ""
    # 版面框，归一化到 0–1000 的 x0/y0/x1/y1；拿不到就空着
    bbox: tuple[int, int, int, int] | None = None


@dataclass(frozen=True)
class ParsedDocument:
    """一份原件解出来的样子。"""

    title: str
    blocks: tuple[Block, ...]
    # ⚠ 截断了**必须说出来**：悄悄截断的话，后面会把「我看到的就是全部」当成
    # 事实，然后对着半份手册下「这份文档里没有这一节」这种结论
    is_truncated: bool = False
    # 解出来的图。⚠ 纯文本与 Markdown 那两路恒空，它们本来就没有图；docx
    # 那一路按图**所在的那一段**给位置，不是拍平成文末一串
    figures: tuple[Figure, ...] = ()


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


class ExternalParseFailed(RuntimeError):
    """外部解析服务这一次没给出结果。

    ⚠ 实现必须把上游的任何失败（连不上、超时、报错、回了解不开的东西）都翻成
    这一个异常，别让 http 客户端的异常漏给调用方：漏出去的话摄取管线要认得
    每一种客户端库的异常类型，而那是把「接哪一路后端」这件事泄进管线里。
    """


@runtime_checkable
class ParserBackend(Protocol):
    """一路解析后端认得哪些原件。两类后端各自往下扩一层。

    ⚠ `suffixes` 与 `media_types` 是**显式白名单**，不做「读得动就收」的兜底。
    """

    @property
    def name(self) -> str:
        """这一路后端在注册表里的名字。⚠ 这三格声明成只读属性而不是可写
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


@runtime_checkable
class DocumentParser(ParserBackend, Protocol):
    """本地库解那一路：在本进程里，用一个 Python 库把一种格式解开。"""

    def parse(self, raw: RawItem) -> ParsedDocument:
        """把一份原件解成保结构的块序列。

        ⚠ 是**同步**的，而且会阻塞：docx/xlsx/pptx 的解析是纯 CPU 的活。
        调用方必须把它扔进进程池——放进事件循环会把整条消费循环连同健康探针
        一起冻住，而现象是「服务好好的，队列不动了」。

        Args: raw。
        """
        ...


@runtime_checkable
class ExternalParserBackend(ParserBackend, Protocol):
    """外部服务解那一路：把原件交给另一个进程/另一台机器上的解析服务。

    ⚠ 与本地那一路**故意不是同一个函数签名**：这一路是异步的网络 IO，一次
    几十秒是常态，而本地那一路是同步的 CPU 活。签名混成一个的话，把外部后端
    当本地的调用会拿到一个没 await 的协程当 `ParsedDocument` 用，而那不报错。

    ⚠ 一期**没有任何实现**，注册表里是空的（ADR-0043）。留一个「看着能用、
    调下去报奇怪错」的 stub 比缺席更糟：缺席能被 `/capabilities` 如实答出来。
    """

    async def parse_remote(
        self, raw: RawItem, timeout_s: float
    ) -> ParsedDocument:
        """把一份原件交给外部服务解，回同样的 `ParsedDocument`。

        ⚠ 实现**必须自己守住 `timeout_s`**（runtime-resilience §2：每个跨进程
        调用都要有超时），也**绝不自己重试**：摄取那条链只有人按「重新解析」
        那一层负责重试，逐层重试会相乘成雪崩。

        ⚠ 上游回的 markdown / 版面 JSON 要在这里翻成带 `locator` 的块序列。
        翻不动就抛 `ExternalParseFailed`，不要回一份没有 locator 的空壳——
        引用指不出出处的答案等于没有。

        Args: raw, timeout_s。
        """
        ...
