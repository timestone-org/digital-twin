"""对外出入参。ORM 模型不许直接返给 HTTP 层。"""

from knowledge_server.apps.knowledge.schemas.capability import (
    CapabilityOut,
    IndexCapabilityOut,
)

__all__ = ["CapabilityOut", "IndexCapabilityOut"]
