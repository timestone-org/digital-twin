"""层 2 的注册表：把几道收窄按序跑一遍。

⚠ 每一道**只许收窄**。放宽的那一道会把前面几道的判断一笔勾销，而顺序一换
结果就变——那时「为什么这个工具有时在有时不在」没人答得上来。这条由
`tests/contract/test_intent_gates.py` 对每一道逐个验。
"""

from ai_assistant.apps.chat.services.intent.gates import GATES
from ai_assistant.apps.chat.services.intent.ports import (
    Allowed,
    Gate,
    TurnContext,
)


def narrow_all(
    context: TurnContext,
    allowed: Allowed,
    gates: tuple[Gate, ...] = GATES,
) -> Allowed:
    """按注册序依次收窄。

    Args: context, allowed（起手的全集）, gates（默认注册表里那几道；
        测试注自己的进来）。
    """
    for gate in gates:
        allowed = gate.narrow(context, allowed)
    return allowed
