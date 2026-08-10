"""异常基类。分层与可重试口径见 docs/agents/runtime-resilience.md §1–§2。

⚠ HTTP 映射在 `lib.errors.handlers`，它依赖 fastapi（`web` extra），
故**不在此处转出**——只装 lib 基础依赖的消费方 import 本包不应被拖着装 fastapi。
"""

from lib.errors.base import (
    AppError,
    Conflict,
    DependencyUnavailable,
    FieldError,
    InfraError,
    NotFound,
    PermissionDenied,
    RateLimited,
    Unauthenticated,
    ValidationFailed,
)

__all__ = [
    "AppError",
    "Conflict",
    "DependencyUnavailable",
    "FieldError",
    "InfraError",
    "NotFound",
    "PermissionDenied",
    "RateLimited",
    "Unauthenticated",
    "ValidationFailed",
]
