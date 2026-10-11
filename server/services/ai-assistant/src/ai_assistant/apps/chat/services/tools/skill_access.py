"""助手的兼容导出；共享技能机制由 llmcore 维护。"""

from llmcore.skills.access import (
    MAX_RESOURCE_CHARS,
    load_skill,
    resource_answer,
    selected_skill,
)

__all__ = [
    "MAX_RESOURCE_CHARS",
    "load_skill",
    "resource_answer",
    "selected_skill",
]
