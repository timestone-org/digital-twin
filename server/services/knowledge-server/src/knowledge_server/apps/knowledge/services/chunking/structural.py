"""按结构切：同一个标题下的块攒成一段，攒够了才在标题边界断开。

⚠ **只在块边界上断**，绝不在句子中间下刀。定长切法切出来的块有一半从半句话
开始，而那半句话在向量空间里几乎没有区分度——表现是「这一段明明有，就是搜不到」。
单块本身就超窗时另说：那时只能在句读处断，见 `sentences.py`。

⚠ 换了标题**不一定断**：还要攒够 `min_tokens`。只有一行标题的块又短又泛，
与任何查询都有中等相似度，专挤名次。本部署实测过：一份 14 块的报告里有 3 块
是 25/29/32 字的光秃秃标题行。

⚠ 攒过了小节的块，标题路径取这几块的**公共祖先**。取第一块或最后一块的路径
都会让引用指向其中一节，而正文里明明有两节；取祖先只是说得粗一点，从不指错。
每一节自己的标题行仍然留在正文里，读的人看得见。

⚠ 标题路径拼进每一块的开头。不拼的话，一块「出口温度不得高于 65 ℃」读不出
它说的是哪台设备，而模型会拿它去回答另一台的问题。
"""

from dataclasses import dataclass, replace

from knowledge_server.apps.knowledge.services.chunking.ports import (
    Chunk,
    ChunkLimits,
)
from knowledge_server.apps.knowledge.services.chunking.sentences import (
    sized_pieces,
)
from knowledge_server.apps.knowledge.services.chunking.tokens import estimated
from knowledge_server.apps.knowledge.services.parsing import (
    Block,
    Locator,
    ParsedDocument,
)


def path_label(locator: Locator) -> str:
    """标题路径摊成一句。

    Args: locator。
    """
    return " > ".join(locator.path)


def sized_blocks(blocks: tuple[Block, ...], max_tokens: int) -> list[Block]:
    """把每一个本身就超窗的块在句读处断成几块。

    ⚠ 排在攒块之前：不断开的话，「只在块边界上下刀」这条规矩对一个两千字的
    段落无能为力——切出来仍是一块超窗的，而超出的那一截被嵌入端点悄悄丢掉。

    ⚠ 预算里先扣掉标题路径：它会拼进块的开头，一起进向量。不扣的话，
    正文刚好卡在窗口上的那一块会因为顶着一行标题而超出去。

    Args: blocks, max_tokens。
    """
    made: list[Block] = []
    for block in blocks:
        budget = max(1, max_tokens - estimated(path_label(block.locator)))
        if estimated(block.text) <= budget:
            made.append(block)
            continue
        made.extend(
            replace(block, text=one) for one in sized_pieces(block.text, budget)
        )
    return made


@dataclass(frozen=True)
class StructuralChunker:
    """按标题分段，攒够了才断，段内按上限断开。"""

    name: str = "structural"

    def split(
        self, document: ParsedDocument, limits: ChunkLimits
    ) -> tuple[Chunk, ...]:
        """同一条标题路径下的块攒成一段，攒够下限才在标题边界断开。

        Args: document, limits。
        """
        made: list[Chunk] = []
        pending: list[Block] = []
        carry = ""
        tokens = 0
        # ⚠ 预算里先扣掉重叠：上一块带下来的那段尾巴会拼在这一块开头，
        # 一起进向量。不扣的话，正文刚好卡在窗口上的那一块会因为顶着一段
        # 尾巴而超出去——而超出的那一截没有任何一处报错
        room = max(1, limits.max_tokens - limits.overlap_chars)
        for block in sized_blocks(document.blocks, room):
            cost = estimated(block.text)
            if pending and _cuts_here(pending[-1], block, tokens, cost, limits):
                made.append(_flushed(pending, carry, len(made)))
                # ⚠ 只有「同一节里太长了」这一种断法才往下带尾巴。换节还带的
                # 话，新块的开头会挂着上一节的结论，而那正是「引用指错地方」
                # 的来路
                carry = (
                    _carried(pending, limits.overlap_chars)
                    if _same_section(pending[-1], block)
                    else ""
                )
                pending, tokens = [], estimated(carry)
            if not pending:
                # 标题路径会拼进这一块的开头，先把它的位子占上。⚠ 按首块的
                # 路径预留：最后拼上去的是这几块的公共祖先，而祖先只会更短
                tokens += estimated(path_label(block.locator))
            pending.append(block)
            tokens += cost
        if pending:
            made.append(_flushed(pending, carry, len(made)))
        return tuple(made)


def _same_section(previous: Block, current: Block) -> bool:
    """这两块还在同一节里吗。

    Args: previous, current。
    """
    return (
        current.kind != "heading"
        and current.locator.path == previous.locator.path
    )


def _cuts_here(
    previous: Block,
    current: Block,
    tokens: int,
    cost: int,
    limits: ChunkLimits,
) -> bool:
    """这两块之间该不该断开。

    ⚠ 换了标题路径**且攒够了**才断。只看标题的话，「标题 → 紧接着下级标题」
    会切出一个只有标题的块；只看长度的话，两节的规定会混进同一块。

    Args: previous, current, tokens（已攒的）, cost（这一块的）, limits。
    """
    if tokens + cost > limits.max_tokens:
        return True
    if _same_section(previous, current):
        return False
    return tokens >= limits.min_tokens


def _common_path(rows: list[Block]) -> tuple[str, ...]:
    """这几块共同的标题路径（公共祖先）。

    Args: rows。
    """
    paths = [one.locator.path for one in rows]
    kept: list[str] = []
    for at in range(min(len(one) for one in paths)):
        step = paths[0][at]
        if any(one[at] != step for one in paths):
            break
        kept.append(step)
    return tuple(kept)


def _carried(rows: list[Block], overlap: int) -> str:
    """断开时往下一块带一段尾巴，按**字符**截，尽量从一句话的开头起。

    ⚠ 带的是文本尾巴而不是「最后那一整块」。带整块的写法在尾块比重叠长时
    一个字都不带——于是重叠这件事在多数情况下根本没发生，而它看起来只是
    「这个问题模型不会」。

    Args: rows, overlap。
    """
    if overlap <= 0 or not rows:
        return ""
    tail = "\n".join(one.text for one in rows)[-overlap:]
    for at, one in enumerate(tail):
        if one in "\n。！？；!?;":
            return tail[at + 1 :].strip()
    return tail.strip()


def _flushed(rows: list[Block], carry: str, start: int) -> Chunk:
    """把攒着的那几块收成一个 chunk。

    Args: rows, carry（上一块带下来的尾巴）, start（已经收了几个）。
    """
    path = _common_path(rows)
    heading = " > ".join(path)
    body = "\n".join(one.text for one in _without_echo(rows, path))
    core = f"{carry}\n{body}" if carry else body
    text = f"{heading}\n{core}" if heading else core
    return Chunk(
        ordinal=start,
        text=text,
        heading_path=heading,
        # ⚠ 起页取首块、止页取末块：只报首页的引用会让人翻到第 4 页却找不到
        # 那句话——它在第 6 页
        locator=replace(rows[0].locator, path=path, page_end=_last_page(rows)),
        token_count=estimated(text),
        figure_refs=_figure_refs(rows),
    )


def _without_echo(rows: list[Block], path: tuple[str, ...]) -> list[Block]:
    """开头那一块若正是标题路径的最后一节，就别让它在正文里再念一遍。

    ⚠ 不去掉的话，一块的正文会是「二、运行参数\n二、运行参数\n下表为…」：
    前缀已经拼过一次，标题块自己又是一块。它既白占窗口预算，又把同一句话在
    向量里加权两次——而两处单看都是对的。

    Args: rows, path（这几块的公共标题路径）。
    """
    if not rows or not path or rows[0].kind != "heading":
        return rows
    return rows[1:] if rows[0].text.strip() == path[-1] else rows


def _figure_refs(rows: list[Block]) -> tuple[str, ...]:
    """这几块里出现过哪几张图，按出现序去重。

    ⚠ 去重但保序：同一张图在一块里被引两次是解析后端的事，而引用面按序展示。

    Args: rows。
    """
    seen: list[str] = []
    for one in rows:
        if one.figure_ref and one.figure_ref not in seen:
            seen.append(one.figure_ref)
    return tuple(seen)


def _last_page(rows: list[Block]) -> int | None:
    """这几块里最后一个有页码的块在第几页；都没有页码就给 `None`。

    Args: rows。
    """
    for one in reversed(rows):
        if one.locator.page is not None:
            return one.locator.page
    return None
