"""模型回传工具名的安全恢复。"""

from langchain_core.messages import AIMessage
from langchain_core.messages.tool import ToolCall

from lib.logging import get_logger

_logger = get_logger("chat.turn")


def restore_offered_aliases(
    reply: AIMessage, offered: frozenset[str]
) -> AIMessage:
    """把本轮工具唯一对应的单下划线别名换回规范名。

    Args: reply, offered。
    """
    if not reply.tool_calls:
        return reply
    aliases: dict[str, str] = {}
    collisions: set[str] = set()
    for canonical in offered:
        alias = canonical.replace(".", "_")
        if alias == canonical:
            continue
        if alias in aliases:
            collisions.add(alias)
        else:
            aliases[alias] = canonical
    for alias in collisions:
        del aliases[alias]

    renamed: list[ToolCall] = []
    restored: list[str] = []
    for call in reply.tool_calls:
        given = call["name"]
        canonical = given if given in offered else aliases.get(given, given)
        renamed.append(ToolCall({**call, "name": canonical}))
        if canonical != given:
            restored.append(canonical)
    if not restored:
        return reply
    _logger.warning(
        "tool_call_alias_restored",
        "模型返回了单下划线工具名，已换回规范名",
        tools=",".join(restored),
    )
    return reply.model_copy(update={"tool_calls": renamed})
