"""层 4 记忆：短期窗口、窗口外的折叠、长期知识。

⚠ 这一包对外只认这个再导出面。别的功能模块直接伸进子模块时结构闸**不会拦**
（它只判跨功能 import 路径的第 4 段是不是 `services`），只能靠这份清单与评审守。
"""

from ai_assistant.apps.chat.services.memory.ports import (
    Hit,
    Knowledge,
    LongTermStore,
    Scope,
    ShortTermStore,
    Summarizer,
    Summary,
)
from ai_assistant.apps.chat.services.memory.summarize import (
    ModelSummarizer,
    NullSummarizer,
)

__all__ = [
    "Hit",
    "Knowledge",
    "LongTermStore",
    "ModelSummarizer",
    "NullSummarizer",
    "Scope",
    "ShortTermStore",
    "Summarizer",
    "Summary",
]
