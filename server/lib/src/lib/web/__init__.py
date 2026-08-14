"""HTTP 装配件。对外口径见 docs/agents/api-contract.md。"""

from lib.web.bootstrap import ReadinessProbe, Runtime, create_app
from lib.web.middleware import RequestContextMiddleware
from lib.web.pagination import (
    CursorPage,
    CursorParams,
    Page,
    PageParams,
    cursor_params,
    decode_cursor,
    encode_cursor,
    page_params,
)
from lib.web.response import (
    SUCCESS_CODE,
    ApiResponse,
    error_payload,
    ok,
)

__all__ = [
    "SUCCESS_CODE",
    "ApiResponse",
    "CursorPage",
    "CursorParams",
    "Page",
    "PageParams",
    "ReadinessProbe",
    "RequestContextMiddleware",
    "Runtime",
    "create_app",
    "cursor_params",
    "decode_cursor",
    "encode_cursor",
    "error_payload",
    "ok",
    "page_params",
]
