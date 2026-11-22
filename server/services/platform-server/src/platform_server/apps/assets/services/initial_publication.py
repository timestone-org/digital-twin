"""用对象存储的条件创建选定首次确认的不可变副本。"""

import uuid
from dataclasses import replace

from pydantic import BaseModel, ValidationError

from lib.logging import get_logger
from lib.objectstore import (
    ObjectChanged,
    ObjectNotFound,
    ObjectStat,
    ObjectStore,
    ObjectStoreError,
)
from lib.utils.ids import uuid7
from platform_server.apps.assets import keys
from platform_server.apps.assets.errors import (
    AssetStoreUnavailable,
    AssetUploadMissing,
)
from platform_server.apps.assets.kinds import kinds

_logger = get_logger("platform.assets.publication")
CLAIM_BYTES = 4096


class PublicationClaim(BaseModel):
    """一个上传 id 唯一选中的私有副本。"""

    kind: str
    candidate: ObjectStat


async def read_claim(
    store: ObjectStore, asset_id: uuid.UUID
) -> PublicationClaim | None:
    """读取已认领的副本。Args: store, asset_id。"""
    key = keys.upload_claim_key(asset_id)
    try:
        stat = await store.stat(key)
        if stat is None:
            return None
        if not 0 < stat.size_bytes <= CLAIM_BYTES:
            raise AssetStoreUnavailable("素材确认记录不完整")
        body = await store.read_prefix(
            key, max_bytes=CLAIM_BYTES, expected_etag=stat.etag
        )
        claim = PublicationClaim.model_validate_json(body)
    except (ObjectStoreError, ValidationError) as error:
        raise AssetStoreUnavailable("素材确认记录暂时无法读取") from error
    if claim.kind not in kinds() or not claim.candidate.key.startswith(
        keys.confirmation_prefix(asset_id)
    ):
        raise AssetStoreUnavailable("素材确认记录不完整")
    return claim


async def claim_upload(
    store: ObjectStore, asset_id: uuid.UUID, kind: str, source: ObjectStat
) -> PublicationClaim:
    """先保存校验过的候选副本，再选定唯一版本。

    Args: store, asset_id, kind, source。
    """
    private_key = keys.confirmation_prefix(asset_id) + str(uuid7())
    offered = PublicationClaim(
        kind=kind, candidate=await _copy_version(store, source, private_key)
    )
    try:
        created = await store.put_if_absent(
            keys.upload_claim_key(asset_id),
            offered.model_dump_json().encode(),
            content_type="application/json",
        )
    except ObjectStoreError as error:
        raise AssetStoreUnavailable("素材确认记录暂时无法写入") from error
    if created:
        return offered
    winner = await read_claim(store, asset_id)
    if winner is None:
        raise AssetStoreUnavailable("素材确认记录暂时无法读取")
    if winner.candidate.key != private_key:
        await discard_candidate(store, private_key)
    return winner


async def publish_original(
    store: ObjectStore, asset_id: uuid.UUID, claim: PublicationClaim
) -> ObjectStat:
    """发布认领的版本，或接续已完成的复制。Args: store, asset_id, claim。"""
    target = keys.object_key(claim.kind, asset_id)
    copied = await _read_stat(store, target)
    if copied is not None and _same_object(copied, claim.candidate):
        return copied
    try:
        return await _copy_version(store, claim.candidate, target)
    except AssetUploadMissing:
        # 并行确认可能已完成并回收了私有副本。
        copied = await _read_stat(store, target)
        if copied is None or not _same_object(copied, claim.candidate):
            raise
        return copied


async def discard_candidate(store: ObjectStore, key: str) -> None:
    """回收私有副本，失败交给暂存区的生命周期。Args: store, key。"""
    try:
        await store.delete(key)
    except ObjectStoreError:
        _logger.warning(
            "asset_candidate_cleanup_failed", "素材确认副本清理失败"
        )


async def _copy_version(
    store: ObjectStore, source: ObjectStat, target: str
) -> ObjectStat:
    """复制指定版本并核实正式元数据。Args: store, source, target。"""
    try:
        await store.copy(source.key, target, expected_etag=source.etag)
    except (ObjectChanged, ObjectNotFound) as error:
        raise AssetUploadMissing("上传内容发生变化，请重新上传") from error
    except ObjectStoreError as error:
        raise AssetStoreUnavailable("素材服务暂时不可用") from error
    copied = await _read_stat(store, target)
    if copied is None or not _same_object(copied, source):
        raise AssetStoreUnavailable("素材复制结果暂时无法核对")
    return copied


async def _read_stat(store: ObjectStore, key: str) -> ObjectStat | None:
    """读取对象元数据。Args: store, key。"""
    try:
        return await store.stat(key)
    except ObjectStoreError as error:
        raise AssetStoreUnavailable("素材服务暂时不可用") from error


def _same_object(current: ObjectStat, expected: ObjectStat) -> bool:
    """比较对象元数据，忽略复制前后的键。Args: current, expected。"""
    return current == replace(expected, key=current.key)
