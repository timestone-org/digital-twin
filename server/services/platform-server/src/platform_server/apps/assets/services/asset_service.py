"""素材的三步：签发凭证 → 浏览器直传 → 确认落库。

⚠ 字节永远不经过本进程。服务端只做三件事：签一张把键、类型与大小都钉死的
凭证；确认字节到了并把它从 `staging/` 搬进正式前缀；落一行元信息。
⚠ 事务边界在本层：crud 只写不提交（database-standard §4）。
"""

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from lib.objectstore import (
    ObjectStat,
    ObjectStore,
    ObjectStoreError,
    PresignedPost,
    UploadLimits,
)
from lib.utils.ids import uuid7
from platform_server.apps.assets import crud, keys
from platform_server.apps.assets.errors import (
    AssetKindUnknown,
    AssetNotFound,
    AssetStoreUnavailable,
    AssetTooLarge,
    AssetTypeRejected,
    AssetUploadMissing,
)
from platform_server.apps.assets.kinds import (
    MIN_UPLOAD_BYTES,
    KindSpec,
    kinds,
)
from platform_server.apps.assets.kinds import spec_of as kind_spec_of
from platform_server.apps.assets.models import Asset
from platform_server.apps.assets.refs import asset_ref
from platform_server.apps.assets.schemas import (
    AssetKindOut,
    AssetOut,
    UploadTicketOut,
)

# 凭证有效期：给大文件的表单填写与一次重试留足余量，又不至于长期可重放
UPLOAD_TTL_S = 900


@dataclass(frozen=True)
class UploadRequest:
    """申请一次直传要的全套。"""

    kind: str
    content_type: str
    size_bytes: int


@dataclass(frozen=True)
class FinalizeRequest:
    """确认一次直传要的全套。类型与大小不在其中——那两样从存储端读。"""

    name: str
    actor: str


def _checked_spec(kind: str, content_type: str, size_bytes: int) -> KindSpec:
    """按素材类型逐条过闸；过不了当场拒，不签凭证。

    Args: kind, content_type, size_bytes。
    """
    spec = kind_spec_of(kind)
    if spec is None:
        raise AssetKindUnknown(f"没有「{kind}」这类素材")
    if not spec.accepts(content_type):
        raise AssetTypeRejected(f"{spec.label}不接受 {content_type} 这种文件")
    if size_bytes > spec.max_bytes:
        raise AssetTooLarge(
            f"{spec.label}最大 {spec.max_bytes // (1024 * 1024)} MB"
        )
    return spec


def kind_catalog() -> list[AssetKindOut]:
    """全部素材类型的登记信息，给前端做选择器与预检。"""
    catalog: list[AssetKindOut] = []
    for kind in kinds():
        spec = kind_spec_of(kind)
        if spec is None:  # pragma: no cover - 目录自洽，取不到即代码错
            continue
        catalog.append(
            AssetKindOut(
                kind=spec.kind,
                label=spec.label,
                content_types=list(spec.content_types),
                max_bytes=spec.max_bytes,
            )
        )
    return catalog


async def presign_upload(
    store: ObjectStore, request: UploadRequest
) -> UploadTicketOut:
    """铸一个素材 id 并签一张直传凭证。**不落行**。

    ⚠ id 在这一步就铸好并编进对象键：finalize 只认这个键，客户端没法把字节
    传到一个 id 下、再拿另一个 id 来确认。
    Args: store, request。
    """
    spec = _checked_spec(request.kind, request.content_type, request.size_bytes)
    asset_id = uuid7()
    ticket = await _presign(store, asset_id, request, spec)
    return UploadTicketOut(
        asset_id=asset_id,
        url=ticket.url,
        fields=ticket.fields,
        expires_seconds=ticket.expires_seconds,
    )


async def _presign(
    store: ObjectStore,
    asset_id: uuid.UUID,
    request: UploadRequest,
    spec: KindSpec,
) -> PresignedPost:
    try:
        return await store.presign_post(
            keys.staging_key(request.kind, asset_id),
            content_type=request.content_type,
            limits=UploadLimits(
                min_bytes=MIN_UPLOAD_BYTES, max_bytes=spec.max_bytes
            ),
            ttl_s=UPLOAD_TTL_S,
        )
    except ObjectStoreError as error:
        raise AssetStoreUnavailable("素材服务暂时不可用") from error


async def finalize_upload(
    session: AsyncSession,
    store: ObjectStore,
    asset_id: uuid.UUID,
    finalize: FinalizeRequest,
) -> AssetOut:
    """确认字节到了：搬进正式前缀并落行。重复调用返回同一个素材。

    ⚠ 类型从**对象键里读回来**，不从请求体里收：键是签凭证时定死的，收一个
    第二来源的 kind 就意味着两者可以对不上，而对不上的那次会把字节搬到错误的
    前缀下——文件在，但按 id 再也找不到它。
    ⚠ 元信息也以存储端读到的为准，不信调用方自报的大小：自报的那份与真实字节
    对不上时，界面上会显示一个与文件本身无关的体积。
    Args: session, store, asset_id, finalize。
    """
    existing = await crud.get(session, asset_id)
    if existing is not None:
        return _present(existing)

    staged = await _find_staged(store, asset_id)
    if staged is None:
        raise AssetUploadMissing("没有收到上传的文件，请重新上传")
    kind, key, stat = staged
    spec = kind_spec_of(kind)
    if spec is None:  # pragma: no cover - 键由本服务铸造，类型必在目录里
        raise AssetKindUnknown(f"没有「{kind}」这类素材")
    if stat.size_bytes > spec.max_bytes:
        raise AssetTooLarge(
            f"{spec.label}最大 {spec.max_bytes // (1024 * 1024)} MB"
        )

    await _promote(store, key, keys.object_key(kind, asset_id))
    await crud.insert_if_absent(
        session,
        crud.AssetWrite(
            asset_id=asset_id,
            kind=kind,
            name=finalize.name,
            content_type=stat.content_type,
            size_bytes=stat.size_bytes,
            checksum=stat.etag,
            created_by=finalize.actor,
        ),
    )
    await session.flush()
    saved = await crud.get(session, asset_id)
    if saved is None:  # pragma: no cover - 刚插进去就取不到即数据库错
        raise AssetNotFound("素材落库失败")
    return _present(saved)


async def _find_staged(
    store: ObjectStore, asset_id: uuid.UUID
) -> tuple[str, str, ObjectStat] | None:
    """在暂存区找这个 id 的字节，顺带把类型读回来。

    逐类探而不是让调用方报：素材类型统共三种，一次 finalize 最多三个 HEAD，
    换来的是「键与类型不可能对不上」。
    """
    for kind in kinds():
        key = keys.staging_key(kind, asset_id)
        stat = await _stat(store, key)
        if stat is not None:
            return kind, key, stat
    return None


async def _stat(store: ObjectStore, key: str) -> ObjectStat | None:
    try:
        return await store.stat(key)
    except ObjectStoreError as error:
        raise AssetStoreUnavailable("素材服务暂时不可用") from error


async def _promote(store: ObjectStore, staged: str, final: str) -> None:
    """把字节从暂存搬到正式前缀，再清掉暂存件。

    ⚠ 先复制后删除，且删除失败不影响结果：反过来做的话，复制成功而删除前
    进程被杀掉会留下一个匿名可读的孤儿；而这个顺序留下的孤儿在 `staging/`，
    既读不到也会被生命周期规则回收。
    """
    try:
        await store.copy(staged, final)
        await store.delete(staged)
    except ObjectStoreError as error:
        raise AssetStoreUnavailable("素材服务暂时不可用") from error


async def read_asset(session: AsyncSession, asset_id: uuid.UUID) -> AssetOut:
    """取一个素材；没有即 404。

    Args: session, asset_id。
    """
    found = await crud.get(session, asset_id)
    if found is None:
        raise AssetNotFound("素材不存在")
    return _present(found)


async def list_assets(
    session: AsyncSession, *, kind: str | None, limit: int, offset: int
) -> list[AssetOut]:
    """列素材，新的在前。

    Args: session, kind（None = 全部）, limit, offset。
    """
    if kind is not None and kind_spec_of(kind) is None:
        raise AssetKindUnknown(f"没有「{kind}」这类素材")
    rows = await crud.list_by_kind(
        session, kind=kind, limit=limit, offset=offset
    )
    return [_present(row) for row in rows]


async def delete_asset(
    session: AsyncSession, store: ObjectStore, asset_id: uuid.UUID
) -> None:
    """删素材：先删字节再删行。删不存在的素材不是错误。

    ⚠ 顺序不能反：先删行再删字节时，删字节失败就留下一堆没有任何一行指向的
    对象——它们再也不会被谁清理，而磁盘占用只涨不落。
    ⚠ 引用检查刻意不做：素材被哪张大屏引用是跨模块的事，逐一扫描配置 JSON
    既慢又不完整（引用可以出现在任意嵌套层）。删掉后大屏那边会显示「取不到」，
    这比让素材库变成只进不出的仓库好。
    Args: session, store, asset_id。
    """
    found = await crud.get(session, asset_id)
    if found is None:
        return
    try:
        await store.delete_prefix(keys.owned_prefix(found.kind, asset_id))
    except ObjectStoreError as error:
        raise AssetStoreUnavailable("素材服务暂时不可用") from error
    await crud.remove(session, asset_id)


def _present(row: Asset) -> AssetOut:
    return AssetOut(
        id=row.id,
        ref=asset_ref(row.id),
        kind=row.kind,
        name=row.name,
        content_type=row.content_type,
        size_bytes=row.size_bytes,
        checksum=row.checksum,
        created_at=row.created_at,
        created_by=row.created_by,
    )
