"""出入参模型。ORM 模型绝不直接返给 HTTP 层。"""

from ai_assistant.apps.chat.schemas.capability import CapabilityOut, SkillOut

__all__ = ["CapabilityOut", "SkillOut"]
