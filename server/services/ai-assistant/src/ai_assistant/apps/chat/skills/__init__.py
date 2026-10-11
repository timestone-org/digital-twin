"""技能目录的兼容查询入口。生产装配使用显式 SkillCatalog。"""

from ai_assistant.apps.chat.skills.manifest import (
    SkillInstructionsMissing,
    SkillManifest,
)
from ai_assistant.apps.chat.skills.registry import (
    SkillCatalog,
    default_catalog,
    load_catalog,
)


def list_skills() -> tuple[SkillManifest, ...]:
    return default_catalog().skills


def find_skill(name: str) -> SkillManifest | None:
    return default_catalog().find(name)


def skills_for(surface_kind: str) -> tuple[SkillManifest, ...]:
    return default_catalog().select(surface_kind)


__all__ = [
    "SkillCatalog",
    "SkillInstructionsMissing",
    "SkillManifest",
    "default_catalog",
    "find_skill",
    "list_skills",
    "load_catalog",
    "skills_for",
]
