"""助手这一套接了哪几道收窄。

按序跑那一步在 `llmcore.intent.registry`；这里只回答「助手接了哪几道」。
"""

from ai_assistant.apps.chat.services.intent.gates import GATES
from llmcore.intent.ports import Allowed, Gate, TurnContext
from llmcore.intent.registry import narrow_all as _narrow_all


def narrow_all(
    context: TurnContext,
    allowed: Allowed,
    gates: tuple[Gate, ...] = GATES,
) -> Allowed:
    """按注册序依次收窄。

    Args: context, allowed（起手的全集）, gates（默认注册表里那几道；
        测试注自己的进来）。
    """
    return _narrow_all(context, allowed, gates)
