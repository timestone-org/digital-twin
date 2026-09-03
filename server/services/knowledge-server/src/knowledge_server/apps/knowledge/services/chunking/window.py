"""定长切：不看结构，按字符数切，块间留重叠。

⚠ 留着它**不是为了用**，是为了当对照组：出了「召回变差」的报告时，没有基线
就只能靠感觉。它也是没有标题层级那些文档（一整篇纯文本日志）的兜底。

⚠ 它切出来的块有一半从句子中间开始——这不是缺陷，是这一路的定义。
选它就要接受这件事。
"""

from dataclasses import dataclass

from knowledge_server.apps.knowledge.services.chunking.ports import (
    Chunk,
    ChunkLimits,
)
from knowledge_server.apps.knowledge.services.chunking.sentences import (
    fitting_chars,
)
from knowledge_server.apps.knowledge.services.chunking.structural import (
    path_label,
)
from knowledge_server.apps.knowledge.services.chunking.tokens import estimated
from knowledge_server.apps.knowledge.services.parsing import ParsedDocument


@dataclass(frozen=True)
class FixedWindowChunker:
    """按字符数切，块间留重叠。"""

    name: str = "window"

    def split(
        self, document: ParsedDocument, limits: ChunkLimits
    ) -> tuple[Chunk, ...]:
        """整份摊平再按窗口切。

        ⚠ 步长必须大于 0：重叠不小于窗口时会原地打转切出无穷多块，
        而那是一次内存耗尽而不是一条错误。这里当场收窄。

        ⚠ 窗口按 token 折成字符数，不写死一个字符上限：中文一字约一 token、
        英文约四字一 token，钉哪一个都会让另一种语言的文档切错一个数量级。

        Args: document, limits。
        """
        if not document.blocks:
            return ()
        text = "\n".join(one.text for one in document.blocks)
        first = document.blocks[0].locator
        max_chars = fitting_chars(text, limits.max_tokens)
        step = max(1, max_chars - max(0, limits.overlap_chars))
        made: list[Chunk] = []
        for start in range(0, len(text), step):
            body = text[start : start + max_chars]
            if not body.strip():
                continue
            # ⚠ 再收一次：`max_chars` 是按整段算的，而中英混排的那几段里
            # 局部的汉字密度可以比整段高，那一片于是仍会超窗
            body = body[: fitting_chars(body, limits.max_tokens)]
            made.append(
                Chunk(
                    ordinal=len(made),
                    text=body,
                    heading_path=path_label(first),
                    locator=first,
                    token_count=estimated(body),
                )
            )
            if start + max_chars >= len(text):
                break
        return tuple(made)
