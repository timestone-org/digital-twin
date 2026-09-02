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


class LlmProvidersDisabled(AppError):
    """本部署没开模型供应商目录（没配加密密钥）。不是故障，是这套环境就没接。"""

    code = 52401
    http_status = 503
