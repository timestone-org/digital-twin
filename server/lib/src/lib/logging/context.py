"""每请求日志上下文（trace_id / span_id / 调用者），经 contextvars 传播。"""

from contextvars import ContextVar, Token
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class LogContext:
    """一次请求或一批任务的日志共同字段。"""

    trace_id: str | None = None
    span_id: str | None = None
    user_id: str | None = None
    route: str | None = None


_EMPTY = LogContext()

_context_var: ContextVar[LogContext] = ContextVar(
    "lib_log_context", default=_EMPTY
)


def current_log_context() -> LogContext:
    """取当前上下文；未绑定时返回空上下文。"""
    return _context_var.get()


def bind_log_context(
    *,
    trace_id: str | None = None,
    span_id: str | None = None,
    user_id: str | None = None,
    route: str | None = None,
) -> Token[LogContext]:
    """在当前上下文上叠加非 None 的字段，返回用于还原的 token。

    Args: trace_id, span_id, user_id, route。
    """
    current = current_log_context()
    merged = replace(
        current,
        trace_id=trace_id if trace_id is not None else current.trace_id,
        span_id=span_id if span_id is not None else current.span_id,
        user_id=user_id if user_id is not None else current.user_id,
        route=route if route is not None else current.route,
    )
    return _context_var.set(merged)


def reset_log_context(token: Token[LogContext]) -> None:
    """还原到 bind 之前。

    Args: token。
    """
    _context_var.reset(token)
