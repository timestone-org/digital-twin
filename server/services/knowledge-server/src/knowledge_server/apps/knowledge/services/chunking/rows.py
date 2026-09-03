"""一行一块：表格类文档的切法。

⚠ 表格的每一行本来就是一条独立记录，攒几行进一块反而会让检索命中整片而指不出
是哪一条。而 xlsx 那一路的解析已经把表头拼进了每一行，所以行块天然自足。

⚠ 非表格块（标题、说明文字）仍然单独成块，不丢：一张表前面那句「以下为
2026 年 1 月」是读懂整张表的前提。
"""

from dataclasses import dataclass

from knowledge_server.apps.knowledge.services.chunking.ports import (
    Chunk,
    ChunkLimits,
)
from knowledge_server.apps.knowledge.services.chunking.structural import (
    path_label,
    sized_blocks,
)
from knowledge_server.apps.knowledge.services.chunking.tokens import estimated
from knowledge_server.apps.knowledge.services.parsing import ParsedDocument


@dataclass(frozen=True)
class RowChunker:
    """一个块一块。"""

    name: str = "rows"

    def split(
        self, document: ParsedDocument, limits: ChunkLimits
    ) -> tuple[Chunk, ...]:
        """逐块转成 chunk，空块跳过；本身超窗的行先在句读处断开。

        ⚠ 一行仍是一块，**不攒批**：表格的每一行本来就是一条独立记录。
        但一行也可能超窗（一格里粘着整篇说明是现场常事），那时它先被断成
        几块——不断的话超出的那一截会被嵌入端点悄悄丢掉。

        Args: document, limits。
        """
        made: list[Chunk] = []
        for block in sized_blocks(document.blocks, limits.max_tokens):
            if not block.text.strip():
                continue
            heading = path_label(block.locator)
            text = f"{heading}\n{block.text}" if heading else block.text
            made.append(
                Chunk(
                    ordinal=len(made),
                    text=text,
                    heading_path=heading,
                    locator=block.locator,
                    token_count=estimated(text),
                )
            )
        return tuple(made)
