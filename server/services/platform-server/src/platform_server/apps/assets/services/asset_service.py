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
from platform_server.apps.assets import variants as variant_catalog
from platform_server.apps.assets.errors import (
    AssetKindUnknown,
    AssetNotCompressible,
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
from platform_server.apps.assets.models import Asset, AssetModelVariant
from platform_server.apps.assets.refs import asset_ref
from platform_server.apps.assets.schemas import (
    AssetKindOut,
    AssetOut,
    AssetVariantOut,
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
    return await _settled(session, asset_id, kind)


async def _settled(
    session: AsyncSession, asset_id: uuid.UUID, kind: str
) -> AssetOut:
    """落行之后把这个素材读回来。

    ⚠ 模型的三行 `pending` 在这一刻就落齐，不是压完才落：界面要能显示
    「正在压」，而「一行都没有」与「压完了但一档都没成」在界面上一模一样。
    Args: session, asset_id, kind。
    """
    if kind == "model":
        await crud.asset_variant.seed_pending(
            session, asset_id, variant_catalog.derived()
        )
    await session.flush()
    saved = await crud.get(session, asset_id)
    if saved is None:  # pragma: no cover - 刚插进去就取不到即数据库错
        raise AssetNotFound("素材落库失败")
    rows = await crud.asset_variant.list_for_asset(session, asset_id)
    return _present(saved, rows)


def needs_compression(asset: AssetOut) -> bool:
    """这个素材要不要排一次压缩。

    ⚠ 判据放在这里而不是路由里：路由只该转手，而「哪类素材有压缩档」是
    素材域自己的事。
    Args: asset。
    """
    return asset.kind == "model"


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
    rows = await crud.asset_variant.list_for_asset(session, asset_id)
    return _present(found, rows)


async def list_assets(
    session: AsyncSession,
    *,
    kind: str | None,
    keyword: str | None,
    limit: int,
    offset: int,
) -> list[AssetOut]:
    """按类型与名字关键词列素材，新的在前。

    ⚠ 关键词只在这里收敛一次空白：调用方传的 `"  "` 与「没传」是同一个意思，
    不折叠的话它会变成一次「名字里含两个空格」的搜索，返回空列表且看不出为什么。
    Args: session, kind（None = 全部）, keyword, limit, offset。
    """
    if kind is not None and kind_spec_of(kind) is None:
        raise AssetKindUnknown(f"没有「{kind}」这类素材")
    trimmed = keyword.strip() if keyword is not None else ""
    rows = await crud.list_by_kind(
        session,
        kind=kind,
        keyword=trimmed or None,
        limit=limit,
        offset=offset,
    )
    # ⚠ 一次查完这一页的全部档，不逐行查一遍：一页 50 条就是 50 次往返
    found = await crud.asset_variant.list_for_assets(
        session, [row.id for row in rows]
    )
    by_asset: dict[uuid.UUID, list[AssetModelVariant]] = {}
    for item in found:
        by_asset.setdefault(item.asset_id, []).append(item)
    return [_present(row, by_asset.get(row.id, [])) for row in rows]


async def rename_asset(
    session: AsyncSession, asset_id: uuid.UUID, name: str
) -> AssetOut:
    """改显示名；素材不存在即 404。

    ⚠ 只改库里的显示名，**不碰对象键**：键由 `(kind, id)` 推导，改名要是连着
    搬字节，存量配置里那些 `asset:<uuid>` 引用会在搬到一半的窗口里取不到，
    而改名本该是一次纯元信息操作。
    Args: session, asset_id, name。
    """
    found = await crud.get(session, asset_id)
    if found is None:
        raise AssetNotFound("素材不存在")
    await crud.rename(session, asset_id, name)
    await session.flush()
    await session.refresh(found)
    rows = await crud.asset_variant.list_for_asset(session, asset_id)
    return _present(found, rows)


async def request_recompression(
    session: AsyncSession, asset_id: uuid.UUID
) -> AssetOut:
    """把一个模型的各档打回待压缩；素材不存在即 404，不是模型即 400。

    ⚠ 打回的是**行的状态**，不删桶里已经压好的字节：压新的那一份会原地覆盖，
    而先删后压会留下一个「旧的没了、新的还没来」的窗口——那期间选了这一档的
    大屏取回 404。
    Args: session, asset_id。
    """
    found = await crud.get(session, asset_id)
    if found is None:
        raise AssetNotFound("素材不存在")
    if found.kind != "model":
        raise AssetNotCompressible("只有三维模型才有压缩档")
    names = variant_catalog.derived()
    # 先补齐可能缺的行（存量素材建表之前传的，一行都没有），再统一打回
    await crud.asset_variant.seed_pending(session, asset_id, names)
    await crud.asset_variant.reset_for_retry(session, asset_id, names)
    await session.flush()
    rows = await crud.asset_variant.list_for_asset(session, asset_id)
    return _present(found, rows)


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
    # 字节走的是整前缀，档行也要跟着删——留着的话下次同 id 复现时会读到一批
    # 指向已经不存在的对象的「ready」
    await crud.asset_variant.remove_for_asset(session, asset_id)
    await crud.remove(session, asset_id)


def _present(
    row: Asset, variant_rows: list[AssetModelVariant] | None = None
) -> AssetOut:
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
        # ⚠ 只有模型才有档。不看 kind 的话，图片与图标会凭空多出三行
        # 「压缩中」，而它们根本不进压缩队列——那三行会永远停在那儿
        variants=(
            _present_variants(variant_rows or []) if row.kind == "model" else []
        ),
    )


def _present_variants(rows: list[AssetModelVariant]) -> list[AssetVariantOut]:
    """按目录顺序铺开各档；库里还没有的那一档也要出现。

    ⚠ 缺的那档补成 `pending` 而不是整个略过：略过的话界面上少一行，
    用户读到的是「这个模型只有两档」，而真相是第三档还没排到。
    """
    by_name = {row.variant: row for row in rows}
    found: list[AssetVariantOut] = []
    for name in variant_catalog.derived():
        spec = variant_catalog.spec_of(name)
        if spec is None:  # pragma: no cover - 目录自洽，取不到即代码错
            continue
        row = by_name.get(name)
        found.append(
            AssetVariantOut(
                variant=name,
                label=spec.label,
                hint=spec.hint,
                status=row.status if row is not None else "pending",
                size_bytes=row.size_bytes if row is not None else None,
                checksum=row.checksum if row is not None else None,
                error=row.error if row is not None else "",
            )
        )
    return found
