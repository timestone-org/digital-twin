"""请求上下文与访问日志。

W3C Trace Context 继承、耗时统计、日志级别按状态码分档。
"""

import time
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from lib.logging.context import bind_log_context, reset_log_context
from lib.logging.logger import get_logger
from lib.logging.trace import new_span_id, new_trace_id, parse_traceparent

TRACEPARENT_HEADER = "traceparent"

SERVER_ERROR_STATUS = 500  # 5xx 起点

_logger = get_logger("lib.web.access")


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else request.url.path


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
        token = bind_log_context(trace_id=trace_id, span_id=span_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
        response.headers[TRACEPARENT_HEADER] = f"00-{trace_id}-{span_id}-01"
        self._log_access(request, response, elapsed_ms)
        reset_log_context(token)
        return response

    def _log_access(
        self, request: Request, response: Response, elapsed_ms: float
    ) -> None:
        if request.url.path in self._health_paths:
            return
        fields = {
            "http_method": request.method,
            "route": _route_template(request),
            "status": response.status_code,
            "duration_ms": elapsed_ms,
        }
        # 4xx 是调用方的问题，不是需要人介入的故障
        if response.status_code >= SERVER_ERROR_STATUS:
            _logger.error("http_request", "请求处理失败", **fields)
        else:
            _logger.info("http_request", "", **fields)
