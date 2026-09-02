"""层 2 意图理解：这一轮模型看得见什么。只做机械收窄，不做分类调用。

⚠ 这一包对外只认这个再导出面。别的功能模块直接伸进子模块时结构闸**不会拦**
（它只判跨功能 import 路径的第 4 段是不是 `services`），只能靠这份清单与评审守。
"""

from ai_assistant.apps.chat.services.intent.gates import GATES, PermissionGate
from ai_assistant.apps.chat.services.intent.registry import narrow_all
from ai_assistant.apps.chat.services.intent.select import allowed_for, specs_for
from llmcore.intent.ports import (
    Allowed,
    Gate,
    TurnContext,
)

__all__ = [
    "GATES",
    "Allowed",
    "Gate",
    "PermissionGate",
    "TurnContext",
    "allowed_for",
    "narrow_all",
    "specs_for",
]
