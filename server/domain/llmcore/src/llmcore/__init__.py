"""OpenAI 兼容端点的调用面。零项目名词，两个服务共用（ADR-0032 决策三）。

⚠ 这一包对外只认这个再导出面：内部形状可以随时改，而消费方只该认
`ModelChoice`、`ChatEndpoint`、`EmbeddingEndpoint` 与两个适配器协议。
"""

from llmcore.catalog import (
    EMPTY_CATALOG,
    MODEL_KIND_CHAT,
    MODEL_KIND_EMBEDDING,
    MODEL_SPEC_KINDS,
    PROVIDER_KIND_CODEX_OAUTH,
    PROVIDER_KIND_OPENAI_COMPAT,
    Assignment,
    CatalogMalformed,
    ModelCatalog,
    ModelSpec,
    ProviderSpec,
    Resolved,
    catalog_version,
)
from llmcore.catalog_client import (
    CATALOG_PATH,
    CatalogCache,
    CatalogClient,
    CatalogSource,
    CatalogUnavailable,
)
from llmcore.codex import (
    CODEX_LEASE_PATH,
    OPTION_DEFAULT_EFFORT,
    CodexOAuthAdapter,
    CodexTokenClient,
    CredentialNotConnected,
    CredentialUnavailable,
    StoredTokenProvider,
    TokenSource,
    UsableToken,
    build_codex_model,
    effort_of,
)
from llmcore.deltas import DeltaChannel, DeltaSink
from llmcore.dynamic_embedding import DynamicEmbeddingAdapter
from llmcore.endpoints import ChatEndpoint, EmbeddingEndpoint
from llmcore.errors import (
    ModelDisabled,
    ModelRejected,
    ModelUnavailable,
    classified,
    is_our_fault,
    reason_of,
)
from llmcore.openai_compat import (
    EndpointResolver,
    OpenAiCompatAdapter,
)
from llmcore.openai_embedding import (
    EMBEDDING_SOURCE,
    EmbeddingShapeChanged,
    OpenAiCompatEmbeddingAdapter,
    build_openai_embedding,
)
from llmcore.ports import (
    DEFAULT_PROFILE,
    MODEL_KINDS,
    EmbeddingAdapter,
    ModelAdapter,
    ModelChoice,
    ModelKind,
    ModelProfile,
    ModelSource,
)
from llmcore.reasoning import ReasoningChatOpenAI

__all__ = [
    "CATALOG_PATH",
    "CODEX_LEASE_PATH",
    "DEFAULT_PROFILE",
    "EMBEDDING_SOURCE",
    "EMPTY_CATALOG",
    "MODEL_KINDS",
    "MODEL_KIND_CHAT",
    "MODEL_KIND_EMBEDDING",
    "MODEL_SPEC_KINDS",
    "OPTION_DEFAULT_EFFORT",
    "PROVIDER_KIND_CODEX_OAUTH",
    "PROVIDER_KIND_OPENAI_COMPAT",
    "Assignment",
    "CatalogCache",
    "CatalogClient",
    "CatalogMalformed",
    "CatalogSource",
    "CatalogUnavailable",
    "ChatEndpoint",
    "CodexOAuthAdapter",
    "CodexTokenClient",
    "CredentialNotConnected",
    "CredentialUnavailable",
    "DeltaChannel",
    "DeltaSink",
    "DynamicEmbeddingAdapter",
    "EmbeddingAdapter",
    "EmbeddingEndpoint",
    "EmbeddingShapeChanged",
    "EndpointResolver",
    "ModelAdapter",
    "ModelCatalog",
    "ModelChoice",
    "ModelDisabled",
    "ModelKind",
    "ModelProfile",
    "ModelRejected",
    "ModelSource",
    "ModelSpec",
    "ModelUnavailable",
    "OpenAiCompatAdapter",
    "OpenAiCompatEmbeddingAdapter",
    "ProviderSpec",
    "ReasoningChatOpenAI",
    "Resolved",
    "StoredTokenProvider",
    "TokenSource",
    "UsableToken",
    "build_codex_model",
    "build_openai_embedding",
    "catalog_version",
    "classified",
    "effort_of",
    "is_our_fault",
    "reason_of",
]
