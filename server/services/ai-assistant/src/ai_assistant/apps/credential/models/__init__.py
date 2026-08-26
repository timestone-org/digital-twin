"""本模块的表。迁移的 `target_metadata` 从这里取 `Base.metadata`。"""

from ai_assistant.apps.credential.models.base import Base
from ai_assistant.apps.credential.models.credential import ModelCredential

__all__ = ["Base", "ModelCredential"]
