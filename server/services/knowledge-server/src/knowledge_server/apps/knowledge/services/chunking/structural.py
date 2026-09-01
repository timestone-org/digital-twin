"""按结构切：同一个标题下的块攒成一段，攒太长就在块边界上断开。

⚠ **只在块边界上断**，绝不在句子中间下刀。定长切法切出来的块有一半从半句话
开始，而那半句话在向量空间里几乎没有区分度——表现是「这一段明明有，就是搜不到」。

⚠ 标题路径拼进每一块的开头。不拼的话，一块「出口温度不得高于 65 ℃」读不出
它说的是哪台设备，而模型会拿它去回答另一台的问题。
"""

from dataclasses import dataclass

from knowledge_server.apps.knowledge.services.chunking.ports import Chunk
from knowledge_server.apps.knowledge.services.chunking.tokens import estimated
from knowledge_server.apps.knowledge.services.parsing import (
    Block,
    Locator,
    ParsedDocument,
)

# 一块最多多少字符。⚠ 有上限：嵌入端点按 token 截断，超了那一截**不报错**，
# 只是没进向量——表现是「这一段怎么都检索不到」
MAX_CHUNK_CHARS = 2_000
# 相邻块的重叠字符数。⚠ 不能是 0：跨过一刀的问题两边都答不出，
# 而它看起来只是「这个问题模型不会」
OVERLAP_CHARS = 200


def path_label(locator: Locator) -> str:
    """标题路径摊成一句。

    Args: locator。
    """
    return " > ".join(locator.path)


def _joined(rows: list[Block]) -> str:
    return "\n".join(one.text for one in rows)


@dataclass(frozen=True)
class StructuralChunker:
    """按标题分段，段内按上限断开。"""

    name: str = "structural"
    max_chars: int = MAX_CHUNK_CHARS
    overlap: int = OVERLAP_CHARS

    def split(self, document: ParsedDocument) -> tuple[Chunk, ...]:
        """同一条标题路径下的块攒成一段。

        Args: document。
        """
        made: list[Chunk] = []
        pending: list[Block] = []
        for block in document.blocks:
            if pending and _cuts_here(pending[-1], block, self.max_chars):
                made.extend(self._flush(pending, len(made)))
                # ⚠ 只有「同一节里太长了」这一种断法才往下带尾巴。换节还带的
                # 话，新块的标题路径会取自**上一节**的那一块——于是引用指向
                # 上一节，而块里的正文是这一节的
                pending = (
                    _carried(pending, self.overlap)
                    if _same_section(pending[-1], block)
                    else []
                )
            pending.append(block)
        made.extend(self._flush(pending, len(made)))
        return tuple(made)

    def _flush(self, rows: list[Block], start: int) -> list[Chunk]:
        """把攒着的那几块收成一个 chunk。

        Args: rows, start（已经收了几个，用来接 ordinal）。
        """
        if not rows:
            return []
        heading = path_label(rows[0].locator)
        body = _joined(rows)
        text = f"{heading}\n{body}" if heading else body
        return [
            Chunk(
                ordinal=start,
                text=text,
                heading_path=heading,
                locator=rows[0].locator,
                token_count=estimated(text),
            )
        ]


def _same_section(previous: Block, current: Block) -> bool:
    """这两块还在同一节里吗。

    Args: previous, current。
    """
    return (
        current.kind != "heading"
        and current.locator.path == previous.locator.path
    )


def _cuts_here(previous: Block, current: Block, max_chars: int) -> bool:
    """这两块之间该不该断开。

    ⚠ 换了标题路径就断，哪怕上一段很短：一块里混着两节的内容时，检索到它的人
    会把两节的规定当成同一节的。

    Args: previous, current, max_chars。
    """
    if not _same_section(previous, current):
        return True
    return len(previous.text) >= max_chars


def _carried(rows: list[Block], overlap: int) -> list[Block]:
    """断开时往下一块带一点尾巴。

    ⚠ 只在**同一条标题路径**内带：跨节带的话，下一节的开头会挂着上一节的
    结论，而那正是「引用指错地方」的来路。

    Args: rows, overlap。
    """
    if overlap <= 0 or not rows:
        return []
    tail = rows[-1]
    if tail.kind == "heading" or len(tail.text) > overlap:
        return []
    return [tail]
