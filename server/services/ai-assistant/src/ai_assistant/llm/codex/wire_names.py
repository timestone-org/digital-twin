"""订阅账号那一路的工具名口径：点号出去换成 `__`，回来再换回去。

⚠ 那个端点只认 `^[a-zA-Z0-9_-]+$` 的工具名，而本服务的工具名用点分命名空间
（`points.search`）。原样发过去是一条 400——`Invalid 'tools[0].name': string
does not match pattern`——它既不说是哪个工具，也不说问题出在点号上（实测）。
按量计费那一路收这样的名字，所以这件事只在这一路上发生。

⚠ **历史里的工具调用也要换。** 上一轮的 `tool_calls` 原样重放同样是 400，
那时的现象是「这个会话从某一轮起再也说不了话」，而新开的会话好好的。

⚠ 换回来是按 `__` 反着切，故规范名里不许出现 `__`——有一条用例钉着整册工具名。
"""

from collections.abc import Sequence
from typing import Any, cast

from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.tools import BaseTool

# 点号在这一路上的替身
WIRE_DOT = "__"
_DOT = "."

# 工具声明里名字所在的那一格
_FUNCTION = "function"
_NAME = "name"

ToolDecl = dict[str, Any] | BaseTool


def to_wire(name: str) -> str:
    """规范名 → 这一路认的名字。

    Args: name。
    """
    return name.replace(_DOT, WIRE_DOT)


def from_wire(name: str) -> str:
    """这一路认的名字 → 规范名。

    Args: name。
    """
    return name.replace(WIRE_DOT, _DOT)


def wired_tools(tools: Sequence[ToolDecl]) -> list[ToolDecl]:
    """把工具声明里的名字换成这一路认的。

    ⚠ 只认摊平成表的声明（`openai_schema` 出的就是）。`BaseTool` 原样放过：
    本服务不从那条路下发工具，改它反而要动一个不属于我们的对象。

    Args: tools。
    """
    return [_wired_decl(one) for one in tools]


def wired_messages(messages: Sequence[BaseMessage]) -> list[BaseMessage]:
    """把历史里每一条工具调用的名字换成这一路认的。

    Args: messages。
    """
    return [_wired_message(one) for one in messages]


def restored(reply: AIMessage) -> AIMessage:
    """把模型回来的那条里的工具名换回规范名。

    ⚠ 不换的话，编排层按名字派发时一个都对不上：现象是「模型说它调了工具，
    然后什么都没发生」。

    Args: reply。
    """
    if not reply.tool_calls:
        return reply
    renamed = [
        {**call, _NAME: from_wire(call[_NAME])} for call in reply.tool_calls
    ]
    return reply.model_copy(update={"tool_calls": renamed})


def _wired_decl(tool: ToolDecl) -> ToolDecl:
    """一条工具声明。

    Args: tool。
    """
    if not isinstance(tool, dict):
        return tool
    inner = tool.get(_FUNCTION)
    if isinstance(inner, dict):
        nested = cast("dict[str, Any]", inner)
        renamed = {**nested, _NAME: to_wire(str(nested[_NAME]))}
        return {**tool, _FUNCTION: renamed}
    if _NAME in tool:
        return {**tool, _NAME: to_wire(str(tool[_NAME]))}
    return tool


def _wired_message(message: BaseMessage) -> BaseMessage:
    """一条历史消息。

    Args: message。
    """
    if not isinstance(message, AIMessage) or not message.tool_calls:
        return message
    renamed = [
        {**call, _NAME: to_wire(call[_NAME])} for call in message.tool_calls
    ]
    return message.model_copy(update={"tool_calls": renamed})
