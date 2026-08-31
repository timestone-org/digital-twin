"""装了哪几道收窄，以及它们的先后。

⚠ 注册是**显式元组**，不靠 import 副作用（ADR-0029 决策四）。

⚠ 顺序在这里**不影响结果**——每一道都只做交集，而交集可交换。留着顺序是为了
让「哪一道把它拿掉的」在日志里说得清；哪天有人写出一道不满足交换律的 Gate，
那道 Gate 本身就是错的（`Gate` 的不变量是只许收窄）。
"""

from ai_assistant.apps.chat.services.intent.gates.permission import (
    PermissionGate,
)
from ai_assistant.apps.chat.services.intent.ports import Gate

GATES: tuple[Gate, ...] = (PermissionGate(),)

__all__ = ["GATES", "PermissionGate"]
