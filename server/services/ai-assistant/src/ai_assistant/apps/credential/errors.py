"""凭据域的异常（错误码领域号 22，与会话面同段）。

message 面向最终用户，不含上游地址与令牌片段。
"""

from lib.errors import AppError


class CredentialNotFound(AppError):
    """这一路模型还没登录过。"""

    code = 42211
    http_status = 404


class ProviderUnknown(AppError):
    """目录里没有这一路要登录的供应商。

    ⚠ 与「本部署没接」分开：这一条的处置是「去模型管理页把那一路配出来」，
    那一条是「这套环境根本没有订阅账号这一路」。
    """

    code = 42214
    http_status = 404


class LoginSessionExpired(AppError):
    """这次设备码登录已经过期或从未开始。"""

    code = 42212
    http_status = 404


class LoginRejected(AppError):
    """上游拒绝了这次登录（授权被拒、码已作废）。"""

    code = 42213
    http_status = 400


class UpstreamUnavailable(AppError):
    """登录服务此刻不可达。"""

    code = 52211
    http_status = 503


class ProviderDisabled(AppError):
    """本部署没接这一路模型。不是故障，是这套环境就没接。"""

    code = 52212
    http_status = 503
