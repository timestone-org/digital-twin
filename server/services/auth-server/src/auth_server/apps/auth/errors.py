"""认证与授权域的异常（错误码领域号 01）。

每个异常自带错误码与 HTTP 状态，处理器不做 `isinstance` 长链分派。
message 面向最终用户，不含表名、SQL、内网地址等内部信息。
"""

from lib.errors import AppError


class InvalidCredentials(AppError):
    """用户名或密码错误。⚠ 不区分「用户不存在」与「密码不对」。"""

    code = 40101
    http_status = 401


class TokenInvalid(AppError):
    """令牌缺失、签名不符、已过期或类型不符。"""

    code = 40102
    http_status = 401


class RefreshTokenRejected(AppError):
    """刷新令牌已被轮换或已登出。命中即视为疑似重放。"""

    code = 40103
    http_status = 401


class AccountDisabled(AppError):
    """账号已停用。"""

    code = 40104
    http_status = 401


class ServiceKeyInvalid(AppError):
    """服务级密钥不符或未配置。未配置一律拒绝，不是放行。"""

    code = 40105
    http_status = 401


class PermissionRequired(AppError):
    """已认证但权限不足。"""

    code = 40106
    http_status = 403


class GrantExceedsOperator(AppError):
    """不能授予自己不具备的权限。"""

    code = 40107
    http_status = 403


class TargetHigherPrivileged(AppError):
    """目标账号的权限高于操作者。"""

    code = 40108
    http_status = 403


class SelfLockout(AppError):
    """该操作会让操作者失去管理能力，或删除最后一个全权账号。"""

    code = 40109
    http_status = 400


class BuiltinImmutable(AppError):
    """内置角色/权限码不可改名、不可改权限集、不可删除。"""

    code = 40110
    http_status = 400


class TooManyLoginAttempts(AppError):
    """登录失败次数过多。"""

    code = 40111
    http_status = 429


class SignupDisabled(AppError):
    """未开放自助注册。"""

    code = 40112
    http_status = 403
