"""结构化日志。字段与级别判据见 docs/agents/observability.md §2。"""

from lib.logging.context import (
    LogContext,
    bind_log_context,
    current_log_context,
    reset_log_context,
)
from lib.logging.logger import (
    ContextLogger,
    configure_logging,
    get_logger,
)
from lib.logging.trace import (
    compose_traceparent,
    current_traceparent,
    new_span_id,
    new_trace_id,
    parse_traceparent,
)

__all__ = [
    "ContextLogger",
    "LogContext",
    "bind_log_context",
    "compose_traceparent",
    "configure_logging",
    "current_log_context",
    "current_traceparent",
    "get_logger",
    "new_span_id",
    "new_trace_id",
    "parse_traceparent",
    "reset_log_context",
]
