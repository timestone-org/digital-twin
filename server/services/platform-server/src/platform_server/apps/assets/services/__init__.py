"""素材库的服务面。跨功能模块只走这里，不许深链到内部文件。"""

from platform_server.apps.assets.services.asset_service import (
    UPLOAD_TTL_S,
    FinalizeRequest,
    UploadRequest,
    delete_asset,
    finalize_upload,
    kind_catalog,
    list_assets,
    needs_compression,
    presign_upload,
    read_asset,
    rename_asset,
    request_recompression,
)

__all__ = [
    "UPLOAD_TTL_S",
    "FinalizeRequest",
    "UploadRequest",
    "delete_asset",
    "finalize_upload",
    "kind_catalog",
    "list_assets",
    "needs_compression",
    "presign_upload",
    "read_asset",
    "rename_asset",
    "request_recompression",
]
