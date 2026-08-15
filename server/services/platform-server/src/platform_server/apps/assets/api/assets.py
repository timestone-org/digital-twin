"""素材面：类型目录、直传三步、浏览与删除。

⚠ 字节不经过本服务：上传是浏览器凭签好的表单直传对象存储，下载是边缘把
`/oss/<对象键>` 反代过去。让字节穿过 API 进程的话，一个 200MB 的模型会把
一个 worker 占住整整几十秒。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.objectstore import ObjectStore
from lib.web import ApiResponse, ok
from platform_server.apps.assets.catalog import ASSET_MANAGE, ASSET_VIEW
from platform_server.apps.assets.deps import (
    get_object_store,
    get_session,
    require,
)
from platform_server.apps.assets.schemas import (
    AssetKindOut,
    AssetOut,
    FinalizeUploadIn,
    PresignUploadIn,
    UploadTicketOut,
)
from platform_server.apps.assets.services import (
    FinalizeRequest,
    UploadRequest,
    delete_asset,
    finalize_upload,
    kind_catalog,
    list_assets,
    presign_upload,
    read_asset,
)
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/assets", tags=["asset"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
StoreDep = Annotated[ObjectStore, Depends(get_object_store)]
ViewDep = Annotated[CallerContext, Depends(require(ASSET_VIEW))]
ManageDep = Annotated[CallerContext, Depends(require(ASSET_MANAGE))]

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


@router.get(
    "/kinds",
    response_model=ApiResponse[list[AssetKindOut]],
    summary="素材类型目录",
)
async def list_kinds(_viewer: ViewDep) -> ApiResponse[list[AssetKindOut]]:
    """列出可上传的素材类型与各自的类型/大小闸。

    Args: _viewer。
    """
    return ok(kind_catalog())


@router.get("", response_model=ApiResponse[list[AssetOut]], summary="素材列表")
async def list_all(
    session: SessionDep,
    _viewer: ViewDep,
    kind: str | None = None,
    limit: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    offset: int = Query(0, ge=0),
) -> ApiResponse[list[AssetOut]]:
    """按类型列素材，新的在前。

    Args: session, _viewer, kind, limit, offset。
    """
    return ok(await list_assets(session, kind=kind, limit=limit, offset=offset))


@router.get(
    "/{asset_id}", response_model=ApiResponse[AssetOut], summary="素材详情"
)
async def get_one(
    session: SessionDep, _viewer: ViewDep, asset_id: uuid.UUID
) -> ApiResponse[AssetOut]:
    """取一个素材。

    Args: session, _viewer, asset_id。
    """
    return ok(await read_asset(session, asset_id))


@router.post(
    ":presign-upload",
    response_model=ApiResponse[UploadTicketOut],
    status_code=status.HTTP_201_CREATED,
    summary="申请直传凭证",
)
async def presign(
    store: StoreDep, actor: ManageDep, body: PresignUploadIn
) -> ApiResponse[UploadTicketOut]:
    """铸一个素材 id 并签一张把键、类型与大小都钉死的直传表单。

    ⚠ 本步**不落行**：没传成的素材不会在库里留下半条记录。
    Args: store, actor, body。
    """
    del actor
    ticket = await presign_upload(
        store,
        UploadRequest(
            kind=body.kind,
            content_type=body.content_type,
            size_bytes=body.size_bytes,
        ),
    )
    return ok(ticket)


@router.post(
    "/{asset_id}:finalize",
    response_model=ApiResponse[AssetOut],
    summary="确认直传完成",
)
async def finalize(
    session: SessionDep,
    store: StoreDep,
    actor: ManageDep,
    asset_id: uuid.UUID,
    body: FinalizeUploadIn,
) -> ApiResponse[AssetOut]:
    """把字节搬进正式前缀并落行。重复调用返回同一个素材。

    Args: session, store, actor, asset_id, body。
    """
    return ok(
        await finalize_upload(
            session,
            store,
            asset_id,
            FinalizeRequest(name=body.name, actor=actor.username),
        )
    )


@router.delete(
    "/{asset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除素材",
)
async def remove_one(
    session: SessionDep, store: StoreDep, actor: ManageDep, asset_id: uuid.UUID
) -> Response:
    """删素材：先删字节再删行。删不存在的素材同样是 204。

    Args: session, store, actor, asset_id。
    """
    del actor
    await delete_asset(session, store, asset_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
