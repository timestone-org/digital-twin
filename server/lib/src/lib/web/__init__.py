"""HTTP 装配件。对外口径见 docs/agents/api-contract.md。"""

from lib.web.bootstrap import ReadinessProbe, Runtime, create_app
from lib.web.middleware import RequestContextMiddleware
from lib.web.pagination import Page, PageParams, page_params
from lib.web.response import (
    SUCCESS_CODE,
    ApiResponse,
    error_payload,
    ok,
)

__all__ = [
    "SUCCESS_CODE",
    "ApiResponse",
    "Page",
    "PageParams",
    "ReadinessProbe",
    "RequestContextMiddleware",
    "Runtime",
    "create_app",
    "error_payload",
    "ok",
    "page_params",
]
