"""技能的对外呈现：把清单摊成能力面上的那份列表。

⚠ 指令正文不出这道门：它是给模型看的，出现在响应里只会让前端多一份没人读、
却会随版本漂移的文本。
"""

from ai_assistant.apps.chat.schemas.capability import SkillOut
from ai_assistant.apps.chat.skills import (
    SkillManifest,
    list_skills,
    skills_for,
)


def skill_catalog() -> list[SkillOut]:
    """全部已装技能，按名字排序。

    ⚠ 排序钉死：顺序不稳的话前端两次拿到的清单顺序可以不同，界面上的技能会跳。
    """
    return _present_all(list_skills())


def skills_of_surface(surface_kind: str) -> list[SkillOut]:
    """某个工作面上可用的技能，按名字排序。

    Args: surface_kind。
    """
    return _present_all(skills_for(surface_kind))


def _present_all(skills: tuple[SkillManifest, ...]) -> list[SkillOut]:
    return [
        _present(skill) for skill in sorted(skills, key=lambda one: one.name)
    ]


def _present(skill: SkillManifest) -> SkillOut:
    return SkillOut(
        name=skill.name,
        title=skill.title,
        summary=skill.summary,
        surface_kinds=list(skill.surface_kinds),
        required_codes=list(skill.required_codes),
    )
