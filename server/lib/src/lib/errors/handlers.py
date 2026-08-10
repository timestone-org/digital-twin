"""把异常翻译成统一错误体。业务层不构造 HTTP 响应。"""

from typing import TYPE_CHECKING

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from lib.errors.base import AppError, FieldError, ValidationFailed
from lib.logging.logger import get_logger
from lib.web.response import error_payload

if TYPE_CHECKING:
    from starlette.responses import Response

_logger = get_logger("lib.errors")

GENERIC_SERVER_MESSAGE = "服务暂时不可用，请稍后重试"
FALLBACK_CODE = 50000
SERVER_ERROR_STATUS = 500  # 5xx 起点

# HTTP 状态码 → 通用错误码，用于框架自身抛出的 HTTPException
_STATUS_TO_CODE = {
    400: 40001,
    401: 40100,
    403: 40106,
    404: 40003,
    405: 40007,
    409: 40004,
    413: 40006,
    415: 40008,
    422: 40001,
    429: 40002,
}


def _field_path(location: tuple[object, ...]) -> str:
    parts: list[str] = []
    for item in location:
        if isinstance(item, int):
            parts.append(f"[{item}]")
        elif item in {"body", "query", "path", "header"}:
            continue
        else:
            parts.append(f".{item}" if parts else str(item))
    return "".join(parts).lstrip(".")


async def _handle_app_error(_request: Request, error: Exception) -> "Response":
    if not isinstance(error, AppError):
        return await _handle_unexpected(_request, error)
    is_client_error = error.http_status < SERVER_ERROR_STATUS
    level = _logger.warning if is_client_error else _logger.error
    level(
        "request_failed",
        error.message,
        code=error.code,
        http_status=error.http_status,
        **error.context,
    )
    return JSONResponse(
        status_code=error.http_status,
        content=error_payload(
            code=error.code,
            message=error.message,
            details=error.details,
        ),
    )


async def _handle_validation_error(
    _request: Request, error: Exception
) -> "Response":
    if not isinstance(error, RequestValidationError):
        return await _handle_unexpected(_request, error)
    details = tuple(
        FieldError(
            field=_field_path(tuple(item["loc"])),
            code=str(item["type"]),
            message=str(item["msg"]),
        )
        for item in error.errors()
    )
    _logger.info("request_invalid", "参数校验失败", field_count=len(details))
    return JSONResponse(
        status_code=ValidationFailed.http_status,
        content=error_payload(
            code=ValidationFailed.code,
            message="参数校验失败",
            details=details,
        ),
    )


async def _handle_http_exception(
    _request: Request, error: Exception
) -> "Response":
    if not isinstance(error, HTTPException):
        return await _handle_unexpected(_request, error)
    code = _STATUS_TO_CODE.get(error.status_code, FALLBACK_CODE)
    message = (
        str(error.detail)
        if error.status_code < SERVER_ERROR_STATUS
        else GENERIC_SERVER_MESSAGE
    )
    return JSONResponse(
        status_code=error.status_code,
        content=error_payload(code=code, message=message),
        headers=error.headers,
    )


async def _handle_unexpected(_request: Request, error: Exception) -> "Response":
    # ⚠ 兜底处理器自身绝不能抛：这里只做定长字段拼装，不碰用户数据
    _logger.error("unhandled_exception", "未捕获异常", error=error)
    return JSONResponse(
        status_code=SERVER_ERROR_STATUS,
        content=error_payload(
            code=FALLBACK_CODE, message=GENERIC_SERVER_MESSAGE
        ),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """把四类异常挂到应用上。由 create_app 单点调用。

    Args: app。
    """
    app.add_exception_handler(AppError, _handle_app_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(HTTPException, _handle_http_exception)
    app.add_exception_handler(Exception, _handle_unexpected)
