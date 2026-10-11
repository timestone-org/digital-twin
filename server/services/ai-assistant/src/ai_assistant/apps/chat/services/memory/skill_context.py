"""助手的兼容导出；共享技能机制由 llmcore 维护。"""

from llmcore.skills.context import (
    MAX_RESTORED_CHARS,
    restored_messages,
)

__all__ = ["MAX_RESTORED_CHARS", "restored_messages"]
