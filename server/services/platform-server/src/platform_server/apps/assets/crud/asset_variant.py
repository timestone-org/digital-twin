"""压缩档行的数据访问。只做查询与写入，**不提交**——事务边界归 service 层。"""

import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lib.utils.ids import uuid7
from platform_server.apps.assets.models import AssetModelVariant


@dataclass(frozen=True)
class VariantResult:
    """一档压成之后从存储端读回来的事实。"""

    size_bytes: int
    checksum: str


async def seed_pending(
    session: AsyncSession, asset_id: uuid.UUID, names: tuple[str, ...]
) -> None:
    """把这个素材的各档落成 `pending`；已经有的那一行原样不动。

    ⚠ 真幂等而不是「先查再插」：队列是 at-least-once，两次并发的确认会双双查空、
    双双插入，第二条撞唯一约束报 500。
    ⚠ **不覆盖已有行**：重投递时把一行 `ready` 改回 `pending`，界面上那一档会
    凭空退回「压缩中」，而它的字节明明还在桶里。要重压走 `reset_for_retry`。
    Args: session, asset_id, names。
    """
    if not names:
        return
    await session.execute(
        insert(AssetModelVariant)
        .values(
            [
                {
                    "id": uuid7(),
                    "asset_id": asset_id,
                    "variant": name,
                    "status": "pending",
                }
                for name in names
            ]
        )
        .on_conflict_do_nothing(
            index_elements=[
                AssetModelVariant.asset_id,
                AssetModelVariant.variant,
            ]
        )
    )


async def reset_for_retry(
    session: AsyncSession, asset_id: uuid.UUID, names: tuple[str, ...]
) -> None:
    """把指定各档打回 `pending` 并清掉上一次的失败原因。

    Args: session, asset_id, names。
    """
    await session.execute(
        update(AssetModelVariant)
        .where(
            AssetModelVariant.asset_id == asset_id,
            AssetModelVariant.variant.in_(names),
        )
        .values(status="pending", error="", size_bytes=None, checksum=None)
    )


async def mark_ready(
    session: AsyncSession,
    asset_id: uuid.UUID,
    variant: str,
    result: VariantResult,
) -> None:
    """记一档压成了。大小与校验和以**存储端读到的**为准。

    Args: session, asset_id, variant, result。
    """
    await session.execute(
        update(AssetModelVariant)
        .where(
            AssetModelVariant.asset_id == asset_id,
            AssetModelVariant.variant == variant,
        )
        .values(
            status="ready",
            size_bytes=result.size_bytes,
            checksum=result.checksum,
            error="",
        )
    )


async def mark_failed(
    session: AsyncSession, asset_id: uuid.UUID, variant: str, reason: str
) -> None:
    """记一档压不出来，并把原因留给界面。

    ⚠ 不自动重试：一个压不动的模型重试一万次也压不动，而重试会把 worker 占满。
    重压由人在界面上按。
    Args: session, asset_id, variant, reason。
    """
    await session.execute(
        update(AssetModelVariant)
        .where(
            AssetModelVariant.asset_id == asset_id,
            AssetModelVariant.variant == variant,
        )
        .values(status="failed", error=reason)
    )


async def list_for_asset(
    session: AsyncSession, asset_id: uuid.UUID
) -> list[AssetModelVariant]:
    """一个素材名下的全部档。

    Args: session, asset_id。
    """
    rows = await session.execute(
        select(AssetModelVariant).where(AssetModelVariant.asset_id == asset_id)
    )
    return list(rows.scalars().all())


async def list_for_assets(
    session: AsyncSession, asset_ids: list[uuid.UUID]
) -> list[AssetModelVariant]:
    """一批素材名下的全部档。

    ⚠ 一次查完而不是逐个素材查一遍：列表页一页 50 条，逐个查就是 50 次往返。
    Args: session, asset_ids。
    """
    if not asset_ids:
        return []
    rows = await session.execute(
        select(AssetModelVariant).where(
            AssetModelVariant.asset_id.in_(asset_ids)
        )
    )
    return list(rows.scalars().all())


async def remove_for_asset(session: AsyncSession, asset_id: uuid.UUID) -> None:
    """删掉一个素材名下的全部档行。

    Args: session, asset_id。
    """
    await session.execute(
        delete(AssetModelVariant).where(AssetModelVariant.asset_id == asset_id)
    )
