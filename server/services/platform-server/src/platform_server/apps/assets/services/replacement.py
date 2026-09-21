"""模型重新上传：私有暂存、独立内容版本与原身份上的原子切换。"""

import uuid
from contextlib import AbstractAsyncContextManager
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from lib.objectstore import (
    ObjectStat,
    ObjectStore,
    ObjectStoreError,
    UploadLimits,
)
from lib.utils.ids import uuid7
from platform_server.apps.assets import crud, keys, variants
from platform_server.apps.assets.crud.asset import (
    ContentWrite,
    model_content,
    switch_content,
)
from platform_server.apps.assets.errors import (
    AssetNotCompressible,
    AssetNotFound,
    AssetReplaceConflict,
    AssetStoreUnavailable,
    AssetTypeRejected,
    AssetUploadMissing,
)
from platform_server.apps.assets.kinds import MIN_UPLOAD_BYTES
from platform_server.apps.assets.schemas.asset import (
    AssetOut,
    ReplaceUploadIn,
    UploadTicketOut,
)
from platform_server.apps.assets.services.asset_service import (
    UPLOAD_TTL_S,
    UploadRequest,
    checked_upload_spec,
    read_asset,
    request_recompression,
)


class Sessions(Protocol):
    """素材操作使用的短事务边界。"""

    def session(self) -> AbstractAsyncContextManager[AsyncSession]:
        """打开一个独立事务。"""
        ...


async def _model(sessions: Sessions, asset_id: uuid.UUID) -> AssetOut:
    async with sessions.session() as session:
        asset = await read_asset(session, asset_id)
    if asset.kind != "model":
        raise AssetNotCompressible("只有三维模型支持重新上传")
    return asset


async def presign_replacement(
    sessions: Sessions,
    store: ObjectStore,
    asset_id: uuid.UUID,
    request: UploadRequest,
) -> UploadTicketOut:
    """签发只用于此模型的新版本凭证。

    Args: sessions, store, asset_id, request。"""
    await _model(sessions, asset_id)
    if request.kind != "model":
        raise AssetTypeRejected("重新上传必须选择三维模型")
    spec = checked_upload_spec(
        "model", request.content_type, request.size_bytes
    )
    upload_id = uuid7()
    try:
        ticket = await store.presign_post(
            keys.replacement_key(asset_id, upload_id),
            content_type=request.content_type,
            limits=UploadLimits(
                min_bytes=MIN_UPLOAD_BYTES, max_bytes=spec.max_bytes
            ),
            ttl_s=UPLOAD_TTL_S,
        )
    except ObjectStoreError as error:
        raise AssetStoreUnavailable("素材服务暂时不可用") from error
    return UploadTicketOut(
        asset_id=upload_id,
        url=ticket.url,
        fields=ticket.fields,
        expires_seconds=ticket.expires_seconds,
    )


async def _prepare(
    store: ObjectStore, asset_id: uuid.UUID, upload_id: uuid.UUID
) -> ContentWrite:
    revision = uuid7()
    key = keys.replacement_key(asset_id, upload_id)
    try:
        stat = await store.stat(key)
        if stat is None:
            raise AssetUploadMissing("没有收到替换文件，请重新上传")
        checked_upload_spec("model", stat.content_type, stat.size_bytes)
        if stat.size_bytes < MIN_UPLOAD_BYTES:
            raise AssetUploadMissing("替换文件为空，请重新上传")
        await store.copy(key, keys.revision_key(asset_id, revision))
        copied = await store.stat(keys.revision_key(asset_id, revision))
        if copied is None or copied != ObjectStat(
            key=copied.key,
            size_bytes=stat.size_bytes,
            content_type=stat.content_type,
            etag=stat.etag,
        ):
            raise AssetUploadMissing("上传内容发生变化，请重新上传")
        return ContentWrite(upload_id=upload_id, revision=revision, stat=copied)
    except ObjectStoreError as error:
        raise AssetStoreUnavailable("素材服务暂时不可用") from error


async def replace_content(
    sessions: Sessions,
    store: ObjectStore,
    asset_id: uuid.UUID,
    body: ReplaceUploadIn,
) -> AssetOut:
    """校验并发布新版本，重复确认同一版本不再次修改。

    Args: sessions, store, asset_id, body。"""
    await _model(sessions, asset_id)
    async with sessions.session() as session:
        current = await crud.get(session, asset_id)
        if current is not None and current.content_upload_id == body.upload_id:
            return await read_asset(session, asset_id)
    prepared = await _prepare(store, asset_id, body.upload_id)
    async with sessions.session() as session:
        if not await switch_content(
            session, asset_id, body.expected_checksum, prepared
        ):
            current = await crud.get(session, asset_id)
            if (
                current is not None
                and current.content_upload_id == body.upload_id
            ):
                return await read_asset(session, asset_id)
            raise AssetReplaceConflict("模型已被其他上传更新，请刷新素材后再试")
        return await request_recompression(session, asset_id)


async def resolve_model(
    session: AsyncSession, asset_id: uuid.UUID, variant: str
) -> str:
    """解析公开模型字节，未就绪的派生档使用当前原件。

    Args: session, asset_id, variant。"""
    if variant not in variants.MODEL_VARIANTS:
        raise AssetNotFound("模型不存在")
    content = await model_content(session, asset_id, variant)
    if content is None:
        raise AssetNotFound("模型不存在")
    revision, ready = content
    if variant != variants.ORIGINAL and not ready:
        variant = variants.ORIGINAL
    return keys.revision_key(asset_id, revision, variant)
