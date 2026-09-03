"""层 3 切块的扩展点：一份解析结果怎么切成检索单位。

加一种切法 = 加一个实现文件 + 注册元组里一行 + 一条契约测试（ADR-0029）。

⚠ 切块只吃 `Block` 序列，**不认原始格式**（ADR-0033 决策四）。这条缝让
「加一种格式」与「改一种切法」彻底解耦：加 PDF 只是多一个解析器，
按标题切那一路一个字都不用改。

⚠ 每一块都要**自足**：读这一块的人（模型或用户）看不到它前后的块。所以标题
路径要拼进块里，表头要拼进行里——不拼的话，检索到一行 `12.5 | 开 | 3`
也读不出它是什么。

⚠ 切多大**不由这一层自己说了算**：上限是嵌入档那一侧的窗口折算来的
（`ChunkLimits`）。这一层定一个自己的常量，就等于赌它比窗口窄，而赌输了
没有任何一处报错。
"""

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from knowledge_server.apps.knowledge.services.parsing import (
    Locator,
    ParsedDocument,
)

# 切块上限占嵌入窗口的几成。⚠ 留余量而不是顶满：`estimated()` 是粗估
# （不引分词器，见 `tokens.py`），而估少了的那一次没有任何一处报错——
# 它只表现为「这一段明明有，就是搜不到」
WINDOW_HEADROOM = 0.9


@dataclass(frozen=True)
class ChunkLimits:
    """一次切块的两条边与重叠。

    ⚠ **上限是嵌入窗口折算来的，不是切块层的常量。** 嵌入端点对超出窗口的那
    一截**静默截断、不报错**：本部署实测 `bge-large-zh-v1.5` 的窗口约 520 个
    汉字，而切块上限曾是 2000 字——最长那一块 2031 字里只有前 520 字进过向量，
    另外 1500 字对向量检索完全不存在，只剩字面那一路能命中。判据是拿两段只有
    结尾不同的长文本量余弦：超过窗口之后余弦恰好等于 1，即两条向量逐位相同。

    ⚠ **下限同样要紧，方向相反。** 只有一行标题的块又短又泛，与任何查询都有
    中等相似度，专挤名次。攒不够下限就继续攒，哪怕跨过一个标题——跨了之后
    标题路径取公共祖先，于是「说得粗一点」而从不指错。
    """

    # 一块最多多少 token。⚠ 已按 `WINDOW_HEADROOM` 折过，不要再拿它当窗口本身
    max_tokens: int
    # 一块至少多少 token；攒不够就跨标题继续攒
    min_tokens: int
    # 相邻块的重叠字符数。⚠ 不能是 0：跨过一刀的问题两边都答不出，
    # 而它看起来只是「这个问题模型不会」
    overlap_chars: int


def limits_for(
    max_input_tokens: int, min_tokens: int, overlap_chars: int
) -> ChunkLimits:
    """按嵌入窗口折出这一次的切块两条边。

    ⚠ 下限被上限压住：配得比上限还大的话，任何一块都攒不到「够了」，
    于是整份文档会被攒成一块——而那一块必然超窗。

    Args: max_input_tokens（嵌入端点的窗口）, min_tokens, overlap_chars。
    """
    ceiling = max(1, int(max_input_tokens * WINDOW_HEADROOM))
    return ChunkLimits(
        max_tokens=ceiling,
        min_tokens=max(0, min(min_tokens, ceiling // 2)),
        overlap_chars=max(0, min(overlap_chars, ceiling)),
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
    # 这一块的正文里出现了哪几张图（按 `Figure.ref`）。
    # ⚠ 收在块上而不是按页反查：一页上可能有五张图而这一块只讲其中一张，
    # 按页反查会把另外四张也贴进引用——那正是「依据里堆一堆没用的东西」
    figure_refs: tuple[str, ...] = ()


def oversized(
    chunks: tuple[Chunk, ...], limits: ChunkLimits
) -> tuple[Chunk, ...]:
    """这一摞里有哪几块装不进窗口。正常情况下一块都没有。

    ⚠ 单拎出来是为了让它被单独测到：它守的那件事**永远不会自己冒出来**——
    超窗的块不报错，只是后半段没进向量。等它在生产里露头时，露的是
    「这一段明明有，就是搜不到」，而那时谁也不会想到来看切块层。

    Args: chunks, limits。
    """
    return tuple(one for one in chunks if one.token_count > limits.max_tokens)


@runtime_checkable
class Chunker(Protocol):
    """一种切法。"""

    @property
    def name(self) -> str:
        """这一路在注册表里的名字。⚠ 声明成只读属性而不是可写字段：
        实现一律是冻结 dataclass，而冻结字段满足不了可写的协议成员。"""
        ...

    def split(
        self, document: ParsedDocument, limits: ChunkLimits
    ) -> tuple[Chunk, ...]:
        """把一份解析结果切成块，`ordinal` 从 0 起连续。

        ⚠ `ordinal` 必须连续且从 0 起：它是 `(document_id, ordinal)` 那条
        唯一键的一半，跳号会让「第 5 块」在重新解析之后指向另一段文字。

        ⚠ **每一块都必须满足 `limits.max_tokens`**，包括拼进去的标题路径与
        重叠尾巴。切不下去的单块要自己在句读处断开——交出去一块超窗的，
        嵌入端点会把超出的那一截悄悄丢掉，而这一层收不到任何反馈。

        Args: document, limits。
        """
        ...
