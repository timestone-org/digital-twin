"""素材面的入参与出参。ORM 模型绝不直接返给 HTTP 层。"""

from platform_server.apps.assets.schemas.asset import (
    AssetKindOut,
    AssetOut,
    AssetUpdateIn,
    FinalizeUploadIn,
    PresignUploadIn,
    UploadTicketOut,
)

__all__ = [
    "AssetKindOut",
    "AssetOut",
    "AssetUpdateIn",
    "FinalizeUploadIn",
    "PresignUploadIn",
    "UploadTicketOut",
]
