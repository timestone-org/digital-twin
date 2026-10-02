"""模型内容替换与公开字节寻址。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from starlette.responses import RedirectResponse

from lib.web import ApiResponse, ok
from platform_server.apps.assets.api.assets import (
    DispatchDep,
    ManageDep,
    SessionDep,
    StoreDep,
)
from platform_server.apps.assets.deps import (
    get_asset_public_base,
    get_asset_sessions,
)
from platform_server.apps.assets.schemas.asset import (
    AssetOut,
    PresignUploadIn,
    ReplaceUploadIn,
    UploadTicketOut,
)
from platform_server.apps.assets.services.asset_service import UploadRequest
from platform_server.apps.assets.services.compress_queue import new_message
from platform_server.apps.assets.services.replacement import (
    Sessions,
    presign_replacement,
    replace_content,
    resolve_model,
)
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=API_PREFIX, tags=["asset"])
SessionsDep = Annotated[Sessions, Depends(get_asset_sessions)]


@router.post(
    "/assets/{asset_id}:presign-replacement",
    response_model=ApiResponse[UploadTicketOut],
    status_code=201,
)
async def presign(
    sessions: SessionsDep,
    store: StoreDep,
    _actor: ManageDep,
    asset_id: uuid.UUID,
    body: PresignUploadIn,
) -> ApiResponse[UploadTicketOut]:
    """申请重新上传凭证。

    Args: sessions, store, _actor, asset_id, body。"""
    request = UploadRequest(
        kind=body.kind,
        content_type=body.content_type,
        size_bytes=body.size_bytes,
    )
    return ok(await presign_replacement(sessions, store, asset_id, request))


@router.post("/assets/{asset_id}:replace", response_model=ApiResponse[AssetOut])
async def replace(
    sessions: SessionsDep,
    store: StoreDep,
    *,
    _actor: ManageDep,
    dispatcher: DispatchDep,
    asset_id: uuid.UUID,
    body: ReplaceUploadIn,
) -> ApiResponse[AssetOut]:
    """确认替换，保留名称和引用。

    Args: sessions, store, _actor, dispatcher, asset_id, body。"""
    saved = await replace_content(sessions, store, asset_id, body)
    dispatcher.after_commit(new_message(asset_id))
    return ok(saved)


@router.get(
    "/public-assets/{asset_id}/{variant}",
    status_code=307,
    response_class=RedirectResponse,
)
async def content(
    session: SessionDep,
    asset_id: uuid.UUID,
    variant: str,
    public_base: Annotated[str, Depends(get_asset_public_base)],
) -> RedirectResponse:
    """只解析公开模型字节，不返回素材元数据。

    Args: session, asset_id, variant, public_base。"""
    key = await resolve_model(session, asset_id, variant)
    return RedirectResponse(
        f"{public_base.rstrip('/')}/{key}",
        headers={"Cache-Control": "no-store"},
    )
