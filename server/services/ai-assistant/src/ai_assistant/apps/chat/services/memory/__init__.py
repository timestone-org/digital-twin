"""层 4 记忆：长期知识，以及那一层要用的常驻提示词与状态块。

短期窗口与窗口外折叠在 `llmcore.memory`——那两样两个服务共用（ADR-0037）。

⚠ 这一包对外只认这个再导出面。别的功能模块直接伸进子模块时结构闸**不会拦**
（它只判跨功能 import 路径的第 4 段是不是 `services`），只能靠这份清单与评审守。
"""

from ai_assistant.apps.chat.services.memory.longterm import (
    PgLongTermStore,
    SessionFactory,
)
from ai_assistant.apps.chat.services.memory.ports import (
    Hit,
    Knowledge,
    LongTermStore,
    Scope,
)
from llmcore.memory import ShortTermStore, Summarizer, Summary
from llmcore.memory.summarize import ModelSummarizer, NullSummarizer

__all__ = [
    "Hit",
    "Knowledge",
    "LongTermStore",
    "ModelSummarizer",
    "NullSummarizer",
    "PgLongTermStore",
    "Scope",
    "SessionFactory",
    "ShortTermStore",
    "Summarizer",
    "Summary",
]
