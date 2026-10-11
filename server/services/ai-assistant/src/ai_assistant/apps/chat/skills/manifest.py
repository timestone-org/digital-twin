"""助手的兼容导出；共享技能机制由 llmcore 维护。"""

from llmcore.skills.manifest import (
    SkillInstructionsMissing,
    SkillManifest,
)

__all__ = ["SkillInstructionsMissing", "SkillManifest"]
