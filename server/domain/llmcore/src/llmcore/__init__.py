"""OpenAI 兼容端点的调用面。零项目名词，两个服务共用（ADR-0032 决策三）。

⚠ 这一包对外只认这个再导出面：内部形状可以随时改，而消费方只该认
`ModelChoice`、`ChatEndpoint`、`EmbeddingEndpoint` 与两个适配器协议。
"""

from llmcore.deltas import DeltaChannel, DeltaSink
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
    "DEFAULT_PROFILE",
    "EMBEDDING_SOURCE",
    "MODEL_KINDS",
    "ChatEndpoint",
    "DeltaChannel",
    "DeltaSink",
    "EmbeddingAdapter",
    "EmbeddingEndpoint",
    "EmbeddingShapeChanged",
    "EndpointResolver",
    "ModelAdapter",
    "ModelChoice",
    "ModelDisabled",
    "ModelKind",
    "ModelProfile",
    "ModelRejected",
    "ModelSource",
    "ModelUnavailable",
    "OpenAiCompatAdapter",
    "OpenAiCompatEmbeddingAdapter",
    "ReasoningChatOpenAI",
    "build_openai_embedding",
    "classified",
    "is_our_fault",
    "reason_of",
]
