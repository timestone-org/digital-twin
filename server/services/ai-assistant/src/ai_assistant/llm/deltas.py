"""模型逐字吐出来的两路增量：**说的话**与**想的过程**。

⚠ 两路分开而不是拼成一路：思考过程动辄比答复长几倍，混进正文的话，用户看到
的是一大段自言自语后面跟着结论，而他要读的只有结论。分开之后界面可以把思考
折起来，且**思考不落库**——下一轮重放时它一个字都不该再喂给模型。

⚠ 口子是**同步回调**而不是协程：它在模型流的循环里逐块调用，每块 await 一次
等于把一次作答拆成几百次事件循环往返。
"""

from collections.abc import Callable
from typing import Literal, cast

from langchain_core.messages import BaseMessage

# 增量走哪一路。⚠ 闭合集合：放开成任意字符串的话，前端遇到没见过的路只能静默
# 丢弃，而「模型明明在说话、界面上什么都没有」是这套东西最难查的一类故障
DeltaChannel = Literal["text", "reasoning"]

# 收增量的口子。给 `None` 表示这一次不要流式
DeltaSink = Callable[[DeltaChannel, str], None]

# 思考过程在 OpenAI 兼容方言里的字段名。⚠ 这是**方言里的字段名**不是厂商名：
# 端点不吐这一格时它恒为空，与「代码里不认任何厂商」并不冲突
REASONING_KEY = "reasoning_content"


def text_of(message: BaseMessage) -> str:
    """一块增量里的正文。

    ⚠ 多模态消息的 content 是一串块，只把文字块取出来：整块 `str()` 出来的是
    一段 Python 字面量，它会原样出现在用户的对话框里。

    Args: message。
    """
    content = message.content
    if isinstance(content, str):
        return content
    parts = [_part_text(one) for one in cast("list[object]", content)]
    return "".join(parts)


def reasoning_of(message: BaseMessage) -> str:
    """一块增量里的思考过程；端点没吐就是空串。

    Args: message。
    """
    given = message.additional_kwargs.get(REASONING_KEY)
    return given if isinstance(given, str) else ""


def emit(message: BaseMessage, sink: DeltaSink) -> None:
    """把一块增量摊给口子。空的那一路不吐。

    ⚠ 思考排在正文前面：同一块里两路都有时，先想后说才是它们发生的顺序。

    Args: message, sink。
    """
    thought = reasoning_of(message)
    if thought:
        sink("reasoning", thought)
    said = text_of(message)
    if said:
        sink("text", said)


def _part_text(part: object) -> str:
    """一个内容块摊成文字；不是文字块就当没有。

    ⚠ 只认这两种形状——上游的块要么是裸串要么是带 `type` 的表。别的类型这里
    当没有，而不是 `str()` 它：那会把一段 Python 字面量摆进用户的对话框。

    Args: part。
    """
    if isinstance(part, str):
        return part
    if isinstance(part, dict):
        body = cast("dict[str, object]", part)
        return str(body.get("text") or "") if body.get("type") == "text" else ""
    return ""
