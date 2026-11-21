"""请求上下文与访问日志。

W3C Trace Context 继承、耗时统计、日志级别按状态码分档。
"""

import time
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from lib.logging.context import LogContext, use_log_context
from lib.logging.logger import get_logger
from lib.logging.trace import (
    compose_traceparent,
    new_span_id,
    new_trace_id,
    parse_traceparent,
)

TRACEPARENT_HEADER = "traceparent"

SERVER_ERROR_STATUS = 500  # 5xx 起点
CLIENT_ERROR_STATUS = 400  # 4xx 起点

_logger = get_logger("lib.web.access")


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else request.url.path


def _since(started: float) -> float:
    """从 `started` 到此刻的毫秒数。"""
    return round((time.perf_counter() - started) * 1000, 3)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """绑定 trace 上下文并输出访问日志。装配由 create_app 单点负责。"""

    def __init__(self, app: ASGIApp, *, health_paths: frozenset[str]) -> None:
        super().__init__(app)
        # 探针每秒一次，进访问日志只会淹没真实流量
        self._health_paths = health_paths

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        trace_id = (
            parse_traceparent(request.headers.get(TRACEPARENT_HEADER))
            or new_trace_id()
        )
        span_id = new_span_id()
        context = LogContext(trace_id=trace_id, span_id=span_id)
        # 外层的错误处理器也会接到已发响应后的异常。
        request.state.request_log_context = context
        started = time.perf_counter()
        with use_log_context(context):
            try:
                response = await call_next(request)
            except Exception:
                self._log_access(request, SERVER_ERROR_STATUS, _since(started))
                raise
            response.headers[TRACEPARENT_HEADER] = compose_traceparent(
                trace_id, span_id
            )
            self._log_access(request, response.status_code, _since(started))
            return response

    def _log_access(
        self, request: Request, status: int, elapsed_ms: float
    ) -> None:
        if request.url.path in self._health_paths:
            return
        fields = {
            "http_method": request.method,
            "route": _route_template(request),
            "status": status,
            "duration_ms": elapsed_ms,
        }
        # 4xx 是调用方的问题，不是需要人介入的故障
        if status >= SERVER_ERROR_STATUS:
            _logger.error("http_request", "请求处理失败", **fields)
        elif status >= CLIENT_ERROR_STATUS:
            _logger.warning("http_request", "请求被拒绝", **fields)
        else:
            _logger.debug("http_request", "", **fields)
