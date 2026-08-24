"""领域服务：技能装配、回合编排、工具分发。"""

from ai_assistant.apps.chat.services.skills import (
    skill_catalog,
    skills_of_surface,
)

__all__ = ["skill_catalog", "skills_of_surface"]
