"""模型接入与调用外壳。

⚠ 这一包对外只认这个再导出面：适配器与注册表的内部形状可以随时改，
而 `planning/turn.py` 与 `advance_service.py` 只该认 `ModelChoice`。
"""

from ai_assistant.llm.adapters import build_adapters
from ai_assistant.llm.deltas import DeltaChannel, DeltaSink
from ai_assistant.llm.errors import (
    ModelDisabled,
    ModelRejected,
    ModelUnavailable,
)
from ai_assistant.llm.guard import GuardedModel
from ai_assistant.llm.ports import (
    CODEX_PROFILE,
    DEFAULT_PROFILE,
    MODEL_KINDS,
    EmbeddingAdapter,
    ModelAdapter,
    ModelChoice,
    ModelKind,
    ModelProfile,
    ModelSource,
)
from ai_assistant.llm.registry import ModelRegistry

__all__ = [
    "CODEX_PROFILE",
    "DEFAULT_PROFILE",
    "MODEL_KINDS",
    "DeltaChannel",
    "DeltaSink",
    "EmbeddingAdapter",
    "GuardedModel",
    "ModelAdapter",
    "ModelChoice",
    "ModelDisabled",
    "ModelKind",
    "ModelProfile",
    "ModelRegistry",
    "ModelRejected",
    "ModelSource",
    "ModelUnavailable",
    "build_adapters",
]
