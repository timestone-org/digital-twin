"""消息在「库里的一行」与「模型认的一条」之间来回。

⚠ 存的是**结构**不是提示词文本：把整段提示词拼好再存，将来改了提示词的写法，
历史会话会用两套口径重放，而模型对同一段对话的理解会跟着变。系统提示词
每次现拼（`prompt.build_system_prompt`），库里一条都不存。

⚠ 工具消息必须带回 `tool_call_id`。丢了它，模型看到的是「有人回了句话，
但不知道回的是哪次调用」——端点那一侧多半直接判请求不合法。

⚠ **没等到回执的调用要补一条失败回执**（`unanswered` / `fillers`）。上一轮被
掐掉、页面被关掉、回执整批被判不合法——这几种情况都会在历史尾部留下一批没人
应答的 `tool_calls`，而端点对「有调用没回应」的一段历史一律判 400。不补的话，
**这个会话从此发不出任何一句**，而新开的会话好好的：现象与原因隔得极远
（实测：一步 37 个调用超过回填上限那次就是这么来的）。

⚠ **图不落库**，落的是一句占位。一张截图是几兆字节的 base64，存进去之后这个
会话每重放一次就把它再喂给模型一遍，上下文与账单一起翻倍。图只活在截它的那
一轮（`perception/vision.py`）。
"""

from collections.abc import Sequence
from math import ceil
from typing import Any, cast

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)
from langchain_core.messages.tool import ToolCall

from llmcore.memory.ports import HistoryRow

# 图片在历史里的占位。⚠ 回放时不重新塞图：一次回放会把会话里每一张图都再喂
# 一遍，而模型早已在当时看过并给出了结论
IMAGE_PLACEHOLDER = "[图片]"
# 哪几种内容块是**图**。⚠ 白名单，不是「除了文字都算图」：思考摘要那一路
# （Responses 方言）也是内容块，当成图的表现是库里留下一句「[图片]」，
# 而它会原样出现在回放出来的对话框里，看着就像一张加载失败的插图
IMAGE_BLOCK_TYPES = frozenset({"image", "image_url", "input_image"})
# 窗口一次脱落几条。⚠ 按台阶脱落而不是逐条：逐条会让窗口每多一条消息就整体
# 前移一格，历史区的前缀从此再也对不上（ADR-0025）
DEFAULT_DROP_STEP = 10

_USER = "user"
_ASSISTANT = "assistant"
_TOOL = "tool"

# 补出来的那条回执说的话。⚠ 说清是「没回执」而不是编一个成功：模型据此决定
# 要不要重做那一步，而假装成功会让它接着往下走
NO_REPLY_TEXT = "失败：这一步没有回执（上一轮被中断了）"


def to_content(message: BaseMessage) -> tuple[str, dict[str, Any]]:
    """把一条模型消息摊成 `(role, content_json)`。

    Args: message。
    """
    if isinstance(message, AIMessage):
        return _ASSISTANT, {
            "text": _text_of(message),
            "tool_calls": list(message.tool_calls),
        }
    if isinstance(message, ToolMessage):
        return _TOOL, {
            "tool_call_id": message.tool_call_id,
            "text": _text_of(message),
        }
    return _USER, {"text": _text_of(message)}


def to_message(row: HistoryRow) -> BaseMessage:
    """把库里的一行还原成模型认的一条。

    Args: row。
    """
    body = row.content_json
    text = str(body.get("text") or "")
    if row.role == _ASSISTANT:
        return AIMessage(content=text, tool_calls=_calls_of(body))
    if row.role == _TOOL:
        return ToolMessage(
            content=text, tool_call_id=str(body.get("tool_call_id") or "")
        )
    return HumanMessage(content=text)


def replay(rows: Sequence[HistoryRow]) -> list[BaseMessage]:
    """把一段历史按 `seq` 还原成模型认的消息列表。

    Args: rows。
    """
    return [to_message(row) for row in sorted(rows, key=lambda one: one.seq)]


def split(
    rows: Sequence[HistoryRow],
    limit: int,
    step: int = DEFAULT_DROP_STEP,
) -> tuple[list[HistoryRow], list[HistoryRow]]:
    """把历史切成「折叠区」与「窗口区」两截，**切点按台阶走**。

    ⚠ 裸的 `[-limit:]` 会让窗口每多一条消息就整体前移一格。端点的前缀缓存认的是
    逐字相同的前缀，于是会话一过 `limit`，历史区**每一轮**都对不上——一个跑了
    几十轮的会话从此再也吃不到缓存，而这件事没有任何运行期迹象。按台阶脱落之后
    起点每 `step` 条才动一次，窗口在 `limit - step` 与 `limit` 之间浮动。

    ⚠ 掐掉窗口头部的孤儿工具消息：切点落在「带工具调用的助手消息」与它的工具
    回应之间时，窗口会以几条没有调用的工具回应开头，端点直接判请求不合法，
    报出来的 400 与真实原因毫无关系。掐头是安全的——窗口保住的是尾部，助手消息
    在窗口里时它的回应一定也在。掐掉的那几条归**折叠区**，不是凭空消失。

    ⚠ **切点是摘要的锚**（`memory/summarize.py`）：折叠区的右边界与窗口的左边界
    是同一个位置，所以摘要与窗口同频——同一个台阶内两者都逐字不变。分两处各算
    一遍的话，两边会在掐孤儿那一步上错开，而错开的表现是摘要每轮都变，
    也就是第五个前缀断点。

    Args: rows, limit（高水位）, step（一次脱落几条）。
    """
    ordered = sorted(rows, key=lambda one: one.seq)
    overflow = max(0, len(ordered) - limit)
    # ⚠ 脱落量要兜底。台阶比高水位还大时（`limit` 小于 `step` 的那些调用），
    # 一个台阶就能把整段历史削光，而表现是模型突然什么都不记得了
    floor = max(limit - step, 1)
    drop = min(ceil(overflow / step) * step, max(0, len(ordered) - floor))
    orphans = 0
    recent = ordered[drop:]
    while orphans < len(recent) and recent[orphans].role == _TOOL:
        orphans += 1
    cut = drop + orphans
    return ordered[:cut], ordered[cut:]


def window(
    rows: Sequence[HistoryRow],
    limit: int,
    step: int = DEFAULT_DROP_STEP,
) -> list[HistoryRow]:
    """取最近的一截历史。切点口径见 `split`。

    Args: rows, limit（高水位）, step（一次脱落几条）。
    """
    return split(rows, limit, step)[1]


def _text_of(message: BaseMessage) -> str:
    """一条消息落库时留下的那段文字。

    ⚠ 多模态消息的 content 是一串块。这里把文字块留下、图片块换成占位——
    原样存的话，一次截图会在库里留下几兆字节，且每次重放都再喂一遍。

    Args: message。
    """
    content = message.content
    if isinstance(content, str):
        return content
    parts = [_part_text(one) for one in cast("list[object]", content)]
    return " ".join(one for one in parts if one)


def _part_text(part: object) -> str:
    """一个内容块摊成文字：文字照抄、图换成占位、别的当没有。

    ⚠ 认不出的块**丢掉而不是当成图**。带思考摘要的那几路（Responses 方言）
    把摘要放进 `reasoning` 块里，与正文块并排——一律当成图的表现是「一条只
    想不说的助手消息在库里成了一句 `[图片] [图片]`」，而它会原样回放到界面上
    也原样喂回给模型。思考本来就不落库（见文件头），丢掉才是对的。

    Args: part。
    """
    if isinstance(part, str):
        return part
    if not isinstance(part, dict):
        return ""
    body = cast("dict[str, object]", part)
    kind = body.get("type")
    if kind == "text":
        return str(body.get("text") or "")
    return IMAGE_PLACEHOLDER if kind in IMAGE_BLOCK_TYPES else ""


def _calls_of(body: dict[str, Any]) -> list[ToolCall]:
    """从落库的载荷里还原工具调用。

    ⚠ 收窄一次而不是原样 `list(...)`：JSONB 出来的是 `Any`，直接喂给
    `AIMessage` 会让整条消息的类型退化成未知，而那会一路传染到编排层。

    Args: body。
    """
    calls = body.get("tool_calls")
    if not isinstance(calls, list):
        return []
    return [cast("ToolCall", item) for item in cast("list[object]", calls)]


def unanswered(messages: list[BaseMessage]) -> tuple[str, ...]:
    """这一段里没等到回执的工具调用 id，按发起顺序。

    ⚠ 端点对「有调用没回应」的一段历史一律判请求不合法，且报出来的 400 与
    真实原因毫无关系。

    Args: messages。
    """
    asked: list[str] = []
    for message in messages:
        if isinstance(message, AIMessage):
            asked.extend(
                str(call.get("id") or "") for call in message.tool_calls
            )
        elif isinstance(message, ToolMessage):
            given = message.tool_call_id
            if given in asked:
                asked.remove(given)
    return tuple(one for one in asked if one)


def fillers(call_ids: tuple[str, ...]) -> list[BaseMessage]:
    """给没回执的调用各补一条失败回执。

    Args: call_ids。
    """
    return [
        ToolMessage(content=NO_REPLY_TEXT, tool_call_id=one) for one in call_ids
    ]
