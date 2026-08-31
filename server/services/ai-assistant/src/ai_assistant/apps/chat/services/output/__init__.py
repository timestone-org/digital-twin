"""层 7 输出：一档 SSE 事件是什么形状。

⚠ 这一包对外只认这个再导出面。别的功能模块直接伸进子模块时结构闸**不会拦**
（它只判跨功能 import 路径的第 4 段是不是 `services`），只能靠这份清单与评审守。
"""

from ai_assistant.apps.chat.services.output.events import (
    EVENT_NAMES,
    EVENT_SPECS,
)
from ai_assistant.apps.chat.services.output.ports import EventSpec

__all__ = [
    "EVENT_NAMES",
    "EVENT_SPECS",
    "EventSpec",
]
