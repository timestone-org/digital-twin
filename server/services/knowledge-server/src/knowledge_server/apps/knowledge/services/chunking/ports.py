"""层 3 切块的扩展点：一份解析结果怎么切成检索单位。

加一种切法 = 加一个实现文件 + 注册元组里一行 + 一条契约测试（ADR-0029）。

⚠ 切块只吃 `Block` 序列，**不认原始格式**（ADR-0033 决策四）。这条缝让
「加一种格式」与「改一种切法」彻底解耦：加 PDF 只是多一个解析器，
按标题切那一路一个字都不用改。

⚠ 每一块都要**自足**：读这一块的人（模型或用户）看不到它前后的块。所以标题
路径要拼进块里，表头要拼进行里——不拼的话，检索到一行 `12.5 | 开 | 3`
也读不出它是什么。
"""

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from knowledge_server.apps.knowledge.services.parsing import (
    Locator,
    ParsedDocument,
)


@dataclass(frozen=True)
class Chunk:
    """一个检索单位。"""

    ordinal: int
    text: str
    # 这一块所在的标题路径，摊成一句给人看的话
    heading_path: str = ""
    locator: Locator = field(default_factory=Locator)
    # 粗估的 token 数，只用来控批与显示，不参与打分
    token_count: int = 0


@runtime_checkable
class Chunker(Protocol):
    """一种切法。"""

    @property
    def name(self) -> str:
        """这一路在注册表里的名字。⚠ 声明成只读属性而不是可写字段：
        实现一律是冻结 dataclass，而冻结字段满足不了可写的协议成员。"""
        ...

    def split(self, document: ParsedDocument) -> tuple[Chunk, ...]:
        """把一份解析结果切成块，`ordinal` 从 0 起连续。

        ⚠ `ordinal` 必须连续且从 0 起：它是 `(document_id, ordinal)` 那条
        唯一键的一半，跳号会让「第 5 块」在重新解析之后指向另一段文字。

        Args: document。
        """
        ...
