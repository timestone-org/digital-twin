"""把需先看结果的工具调用从模型同批请求里单独取出。"""

from collections.abc import Set

from langchain_core.messages import AIMessage


def isolate_exclusive_call(
    reply: AIMessage, exclusive_names: Set[str]
) -> AIMessage:
    """含独占工具时只保留第一个独占调用。

    Args: reply, exclusive_names。
    """
    selected = next(
        (call for call in reply.tool_calls if call["name"] in exclusive_names),
        None,
    )
    if selected is None:
        return reply
    if len(reply.tool_calls) == 1 and not reply.invalid_tool_calls:
        return reply
    return reply.model_copy(
        update={"tool_calls": [selected], "invalid_tool_calls": []}
    )
