"""层 1 来源：知识从哪来。文件上传只是其中一路。"""

from knowledge_server.apps.knowledge.services.sources.keys import (
    base_prefix,
    document_key,
    staging_key,
    suffix_of,
)
from knowledge_server.apps.knowledge.services.sources.ports import (
    DiscoveredItem,
    DiscoveredPage,
    KnowledgeSource,
    SourceUnavailable,
)
from knowledge_server.apps.knowledge.services.sources.registry import (
    DuplicateSource,
    SourceDeps,
    UnknownSource,
    build_sources,
    source_for,
    source_kinds,
)
from knowledge_server.apps.knowledge.services.sources.upload import (
    UPLOAD_KIND,
    UploadSource,
)

__all__ = [
    "UPLOAD_KIND",
    "DiscoveredItem",
    "DiscoveredPage",
    "DuplicateSource",
    "KnowledgeSource",
    "SourceDeps",
    "SourceUnavailable",
    "UnknownSource",
    "UploadSource",
    "base_prefix",
    "build_sources",
    "document_key",
    "source_for",
    "source_kinds",
    "staging_key",
    "suffix_of",
]
