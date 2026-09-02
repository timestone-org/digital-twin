"""把一个回合摊成 SSE 事件。

⚠ 这一包对外只认这个再导出面。别的模块直接伸进子模块时结构闸**不会拦**，
只能靠这份清单与评审守。
"""

from llmcore.output.events import EVENT_NAMES, EVENT_SPECS
from llmcore.output.ports import EventSpec

__all__ = [
    "EVENT_NAMES",
    "EVENT_SPECS",
    "EventSpec",
]
