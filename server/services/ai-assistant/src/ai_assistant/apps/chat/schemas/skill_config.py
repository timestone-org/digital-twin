"""助手的兼容导出；共享技能机制由 llmcore 维护。"""

from llmcore.skills.schemas import (
    SkillIntegration,
    SkillMetadata,
    SkillRoute,
    SkillRoutes,
)

__all__ = ["SkillIntegration", "SkillMetadata", "SkillRoute", "SkillRoutes"]
