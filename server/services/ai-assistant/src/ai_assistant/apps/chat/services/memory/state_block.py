"""每轮重建的那一段：这一屏此刻的样子 + 当前计划，挂在对话**最末尾**。

⚠ 它必须在最后。前缀缓存只认逐字相同的前缀，而这一段每一轮都不一样——放进
常驻提示词的话，它后面的工具声明与整段历史会跟着作废（`prompt.py` 文件头）。
放在最后，变的只是末尾这一小段，前面十几 k 字符照命中。

⚠ 位置定成「永远最后一条」，不分是用户发话还是工具回填——一条规则通两路。
工具回填那一路本来也没得选：那一批工具消息与它们的调用必须相邻，中间插一条
人类消息会把它们拆开（`incoming_messages` 为同一个理由把图排在最后）。

⚠ 它**不落库**。落进去的话，一个会话每重放一次就把几十份过期快照再喂一遍——
而模型分不出哪一份是此刻的。库里只留真实发生过的对话（`history.py` 文件头）。
"""

from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage

from ai_assistant.apps.chat.services.perception import surface_context
from ai_assistant.apps.chat.services.planning import plan as plan_service

# 包住这一段的标记。⚠ 要说清它不是用户说的话：不说的话，模型会把这一大段
# JSON 当成用户刚敲进去的东西，然后回一句「你贴的这个是什么意思」
_OPEN = '<当前状态 说明="系统每轮自动注入的实时快照，不是用户说的话">'
_CLOSE = "</当前状态>"


def render(context: dict[str, Any] | None, plan: dict[str, Any] | None) -> str:
    """把这一轮的实时状态摊成一段；没有任何状态时给空串。

    ⚠ 快照排在计划之前：模型先看清这一屏此刻的样子，再对照计划决定下一步——
    它自己上一轮动过的东西就在快照里。

    Args: context（工作面此刻的摘要）, plan（会话上的当前计划）。
    """
    parts = [surface_context.render(context), plan_service.render(plan)]
    body = "\n\n".join(one for one in parts if one)
    if not body:
        return ""
    return f"{_OPEN}\n\n{body}\n\n{_CLOSE}"


def messages_of(
    context: dict[str, Any] | None, plan: dict[str, Any] | None
) -> list[BaseMessage]:
    """这一轮要挂在末尾的状态块；没有状态时一条都不挂。

    Args: context, plan。
    """
    body = render(context, plan)
    return [HumanMessage(content=body)] if body else []
