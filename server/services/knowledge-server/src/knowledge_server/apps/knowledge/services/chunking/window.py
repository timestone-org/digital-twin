"""定长切：不看结构，按字符数切，块间留重叠。

⚠ 留着它**不是为了用**，是为了当对照组：出了「召回变差」的报告时，没有基线
就只能靠感觉。它也是没有标题层级那些文档（一整篇纯文本日志）的兜底。

⚠ 它切出来的块有一半从句子中间开始——这不是缺陷，是这一路的定义。
选它就要接受这件事。
"""

from dataclasses import dataclass

from knowledge_server.apps.knowledge.services.chunking.ports import Chunk
from knowledge_server.apps.knowledge.services.chunking.structural import (
    MAX_CHUNK_CHARS,
    OVERLAP_CHARS,
    path_label,
)
from knowledge_server.apps.knowledge.services.chunking.tokens import estimated
from knowledge_server.apps.knowledge.services.parsing import ParsedDocument


@dataclass(frozen=True)
class FixedWindowChunker:
    """按字符数切，块间留重叠。"""

    name: str = "window"
    max_chars: int = MAX_CHUNK_CHARS
    overlap: int = OVERLAP_CHARS

    def split(self, document: ParsedDocument) -> tuple[Chunk, ...]:
        """整份摊平再按窗口切。

        ⚠ 步长必须大于 0：`overlap >= max_chars` 时会原地打转切出无穷多块，
        而那是一次内存耗尽而不是一条错误。这里当场收窄。

        Args: document。
        """
        if not document.blocks:
            return ()
        text = "\n".join(one.text for one in document.blocks)
        first = document.blocks[0].locator
        step = max(1, self.max_chars - max(0, self.overlap))
        made: list[Chunk] = []
        for start in range(0, len(text), step):
            body = text[start : start + self.max_chars]
            if not body.strip():
                continue
            made.append(
                Chunk(
                    ordinal=len(made),
                    text=body,
                    heading_path=path_label(first),
                    locator=first,
                    token_count=estimated(body),
                )
            )
            if start + self.max_chars >= len(text):
                break
        return tuple(made)
