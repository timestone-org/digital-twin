"""对外出入参。ORM 模型不许直接返给 HTTP 层。"""

from knowledge_server.apps.knowledge.schemas.capability import (
    CapabilityOut,
    IndexCapabilityOut,
    ParsingCapabilityOut,
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
    SyncOut,
)
from knowledge_server.apps.knowledge.schemas.search import (
    AskIn,
    AskOut,
    HitOut,
    LocatorOut,
    SearchIn,
    SearchOut,
)

__all__ = [
    "AskIn",
    "AskOut",
    "CapabilityOut",
    "DocumentOut",
    "HitOut",
    "IndexCapabilityOut",
    "KnowledgeBaseIn",
    "KnowledgeBaseOut",
    "LocatorOut",
    "ParsingCapabilityOut",
    "RegisterDocumentIn",
    "SearchIn",
    "SearchOut",
    "SourceIn",
    "SourceOut",
    "SyncOut",
    "UploadTicketIn",
    "UploadTicketOut",
    "checked_status",
]
