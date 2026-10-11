"""助手的兼容导出；共享技能机制由 llmcore 维护。"""

from llmcore.skills.loader import (
    MAX_RESOURCE_BYTES,
    MAX_RESOURCE_FILES,
    MAX_SKILL_BYTES,
    MAX_SKILL_CHARS,
    read_resource,
    read_skill,
    read_text,
    resource_names,
)

__all__ = [
    "MAX_RESOURCE_BYTES",
    "MAX_RESOURCE_FILES",
    "MAX_SKILL_BYTES",
    "MAX_SKILL_CHARS",
    "read_resource",
    "read_skill",
    "read_text",
    "resource_names",
]
