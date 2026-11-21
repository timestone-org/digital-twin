"""统一响应信封 `{code,message,data,trace_id}`。

HTTP 状态码由路由与异常处理器各自给真值，信封**不取代** HTTP 语义
（见 docs/agents/api-contract.md §3.2）。
"""

from pydantic import BaseModel, Field

from lib.errors.payload import error_payload
from lib.logging.context import current_log_context

__all__ = [
    "SUCCESS_CODE",
    "SUCCESS_MESSAGE",
    "ApiResponse",
    "FieldErrorOut",
    "error_payload",
    "ok",
]


SUCCESS_CODE = 0
SUCCESS_MESSAGE = "ok"


class FieldErrorOut(BaseModel):
    """字段级校验错误的对外形状。"""

    field: str
    code: str
    message: str


class ApiResponse[DataT](BaseModel):
    """全部响应体的唯一形状。204 无 body 时不适用。"""

    code: int = SUCCESS_CODE
    message: str = SUCCESS_MESSAGE
    data: DataT | None = None
    trace_id: str = ""
    details: list[FieldErrorOut] | None = Field(default=None)


def _trace_id() -> str:
    return current_log_context().trace_id or ""


def ok[DataT](
    data: DataT | None = None,
    *,
    message: str = SUCCESS_MESSAGE,
) -> ApiResponse[DataT]:
    """成功响应。状态码由路由声明，不在这里决定。

    Args: data, message。
    """
    return ApiResponse[DataT](
        code=SUCCESS_CODE,
        message=message,
        data=data,
        trace_id=_trace_id(),
    )
