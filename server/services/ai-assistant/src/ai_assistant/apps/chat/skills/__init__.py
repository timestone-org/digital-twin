"""技能注册表。

⚠ 注册是**显式的一步**（一个字面量元组），不是「import 了某个文件」就自动生效：
隐式注册会让「装了哪些技能」取决于 import 顺序，而 import 顺序在测试里与生产里
可以不同。同样的理由让本仓的前端模块注册也保持显式（DASHBOARD_DESIGN §5.1）。
"""

from ai_assistant.apps.chat.skills.dashboard_binding import DASHBOARD_BINDING
from ai_assistant.apps.chat.skills.dashboard_compose import DASHBOARD_COMPOSE
from ai_assistant.apps.chat.skills.dashboard_interact import DASHBOARD_INTERACT
from ai_assistant.apps.chat.skills.dashboard_review import DASHBOARD_REVIEW
from ai_assistant.apps.chat.skills.formula_author import FORMULA_AUTHOR
from ai_assistant.apps.chat.skills.manifest import (
    SkillInstructionsMissing,
    SkillManifest,
)

SKILLS: tuple[SkillManifest, ...] = (
    DASHBOARD_BINDING,
    DASHBOARD_COMPOSE,
    DASHBOARD_INTERACT,
    DASHBOARD_REVIEW,
    FORMULA_AUTHOR,
)


def list_skills() -> tuple[SkillManifest, ...]:
    """全部已装技能。"""
    return SKILLS


def find_skill(name: str) -> SkillManifest | None:
    """按名字找一个技能；没有就给 None。

    Args: name。
    """
    return next((skill for skill in SKILLS if skill.name == name), None)


def skills_for(surface_kind: str) -> tuple[SkillManifest, ...]:
    """某个工作面上可用的技能。

    Args: surface_kind。
    """
    return tuple(
        skill for skill in SKILLS if surface_kind in skill.surface_kinds
    )


__all__ = [
    "SKILLS",
    "SkillInstructionsMissing",
    "SkillManifest",
    "find_skill",
    "list_skills",
    "skills_for",
]
