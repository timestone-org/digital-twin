"""这一轮模型看得见什么：按序收窄。"""

from llmcore.intent.ports import Allowed, Gate, TurnContext
from llmcore.intent.registry import narrow_all

__all__ = ["Allowed", "Gate", "TurnContext", "narrow_all"]
