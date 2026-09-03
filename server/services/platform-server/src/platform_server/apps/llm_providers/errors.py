"""模型供应商域的异常（错误码领域号 24，见 docs/agents/api-contract.md §4.1）。

message 面向最终用户，不含端点地址、密钥与上游返回的原文。
"""

from lib.errors import AppError


class LlmProviderNotFound(AppError):
    """没有这一路供应商。"""

    code = 42401
    http_status = 404


class LlmProviderNameTaken(AppError):
    """名字被另一路占了。"""

    code = 42402
    http_status = 409


class LlmProviderInUse(AppError):
    """这一路还被某个用途指着，删不得。

    ⚠ 与「不存在」分开：这一条的处置是「先把用途改指别处」，
    那一条是「换个 id」。
    """

    code = 42403
    http_status = 409


class LlmPurposeUnknown(AppError):
    """未登记的用途。"""

    code = 42404
    http_status = 404


class LlmModelUnknown(AppError):
    """这一路上没有这个模型，或它的种类配不上这个用途。"""

    code = 42405
    http_status = 400


class LlmProviderShapeRejected(AppError):
    """配的那几格与这一路的接入形态对不上。

    ⚠ 与「参数不合法」分开：这一条的处置是「这一形态不要填这一格」，
    而不是「换个取值」。
    """

    code = 42406
    http_status = 400


class LlmPurposeMismatch(AppError):
    """这一路的接入形态接不了这个用途。

    ⚠ 拦在写入侧：放行的话分配写得进去，而那一侧解不出任何东西、仍在用
    环境变量那一档，界面上却显示配好了。
    """

    code = 42407
    http_status = 400


class LlmCredentialNotFound(AppError):
    """这一路供应商还没登录过。"""

    code = 42408
    http_status = 404


class LlmLoginRejected(AppError):
    """上游拒绝了这次登录（授权被拒、码已作废）。"""

    code = 42409
    http_status = 400


class LlmLoginSessionExpired(AppError):
    """这次设备码登录已经过期或从未开始。"""

    code = 42410
    http_status = 404


class LlmCredentialStale(AppError):
    """登录过，但那一份已经续不动了——要人重新登一次。

    ⚠ 与「还没登录过」分开：这一条的处置是「重新登录」，那一条是「先登录」；
    与「暂时不可用」也分开——混成一档的话，人会去查网络而不是去登录。
    """

    code = 42411
    http_status = 409


class LlmProviderNotLoginBased(AppError):
    """这一形态不走登录（它填的是端点与密钥）。"""

    code = 42412
    http_status = 400


class LlmProvidersDisabled(AppError):
    """本部署没开模型供应商目录（没配加密密钥）。不是故障，是这套环境就没接。"""

    code = 52401
    http_status = 503


class LlmLoginUpstreamUnavailable(AppError):
    """登录服务此刻不可达。"""

    code = 52402
    http_status = 503
