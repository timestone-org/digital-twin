"""素材域的异常（错误码领域号 15，见 docs/agents/api-contract.md §4.1）。

每个异常自带错误码与 HTTP 状态，处理器不做 `isinstance` 长链分派。
message 面向最终用户，不含桶名、对象键、内网地址等内部信息。
"""

from lib.errors import AppError


class AssetKindUnknown(AppError):
    """不是已登记的素材类型。"""

    code = 41501
    http_status = 400


class AssetTypeRejected(AppError):
    """内容类型不在这一类素材的白名单里。"""

    code = 41502
    http_status = 400


class AssetTooLarge(AppError):
    """超过这一类素材的大小上限。"""

    code = 41503
    http_status = 400


class AssetNotFound(AppError):
    """没有这个素材。"""

    code = 41504
    http_status = 404


class AssetUploadMissing(AppError):
    """凭证签发了，但没等到上传的字节。

    ⚠ 与「素材不存在」分开：这一条的处置是「重传一次」，而那一条是
    「换一个 id」。合成一个码会让调用方无从判断该重试还是该放弃。
    """

    code = 41505
    http_status = 409


class AssetNotCompressible(AppError):
    """这类素材没有压缩档。

    ⚠ 与「素材不存在」分开：这一条的处置是「别按那个按钮」，而那一条是
    「换一个 id」。合成一个码会让调用方无从判断。
    """

    code = 41506
    http_status = 400


class AssetStoreUnavailable(AppError):
    """对象存储不可达或拒绝了操作。"""

    code = 51501
    http_status = 503
