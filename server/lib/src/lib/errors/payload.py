"""共享错误信封的数据形状。"""

from typing import Any

from lib.errors.base import FieldError
from lib.logging.context import current_log_context


def error_payload(
    *,
    code: int,
    message: str,
    details: tuple[FieldError, ...] = (),
) -> dict[str, Any]:
    """失败响应体（供异常处理器构造 JSONResponse）。

    Args: code, message, details。
    """
    body: dict[str, Any] = {
        "code": code,
        "message": message,
        "data": None,
        "trace_id": current_log_context().trace_id or "",
    }
    if details:
        body["details"] = [
            {
                "field": item.field,
                "code": item.code,
                "message": item.message,
            }
            for item in details
        ]
    return body
