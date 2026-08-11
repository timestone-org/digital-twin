"""异常基类：每个异常自带错误码、HTTP 状态与可重试标注。

不用 `isinstance` 长链条分派——那条链一定会漏掉新加的异常，漏掉即 500。
错误码分段十进制 `<4|5><领域两位><序号两位>`，领域 00 通用、01 认证与授权。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class FieldError:
    """字段级校验错误。`field` 用点号与方括号表达嵌套路径。"""

    field: str
    code: str
    message: str


class AppError(Exception):
    """全部业务与基础设施异常的根。子类只覆盖三个类属性。"""

    code: int = 50000
    http_status: int = 500
    is_retryable: bool = False

    def __init__(
        self,
        message: str,
        *,
        details: tuple[FieldError, ...] = (),
        context: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.details = details
        # 只进日志，不进响应体（见 docs/agents/api-contract.md §4.2）
        self.context = context or {}


class ValidationFailed(AppError):
    """请求参数不合法。"""

    code = 40001
    http_status = 400


class RateLimited(AppError):
    """超出限额。"""

    code = 40002
    http_status = 429


class NotFound(AppError):
    """资源不存在，或存在但调用者无权看见。"""

    code = 40003
    http_status = 404


class Conflict(AppError):
    """唯一键或版本冲突。"""

    code = 40004
    http_status = 409


class Unauthenticated(AppError):
    """未认证：无凭据、凭据无效或已过期。

    ⚠ 这是通用兜底码。服务侧要区分「口令错」「令牌过期」「账号停用」时，
    在自己的领域里另开码，不要复用它——错误码一经发布不许改变含义。
    """

    code = 40100
    http_status = 401


class PermissionDenied(AppError):
    """已认证但权限不足。"""

    code = 40106
    http_status = 403


class InfraError(AppError):
    """外部依赖出错且重试无意义。"""

    code = 50000
    http_status = 500


class DependencyUnavailable(AppError):
    """下游暂时不可用，重试有意义。"""

    code = 50001
    http_status = 503
    is_retryable = True
