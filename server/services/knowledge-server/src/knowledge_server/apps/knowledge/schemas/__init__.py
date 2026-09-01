"""对外出入参。ORM 模型不许直接返给 HTTP 层。"""

from knowledge_server.apps.knowledge.schemas.capability import (
    CapabilityOut,
    IndexCapabilityOut,
)
from knowledge_server.apps.knowledge.schemas.document import (
    DocumentOut,
    RegisterDocumentIn,
    UploadTicketIn,
    UploadTicketOut,
    checked_status,
)
from knowledge_server.apps.knowledge.schemas.library import (
    KnowledgeBaseIn,
    KnowledgeBaseOut,
    SourceIn,
    SourceOut,
)

__all__ = [
    "CapabilityOut",
    "DocumentOut",
    "IndexCapabilityOut",
    "KnowledgeBaseIn",
    "KnowledgeBaseOut",
    "RegisterDocumentIn",
    "SourceIn",
    "SourceOut",
    "UploadTicketIn",
    "UploadTicketOut",
    "checked_status",
]
