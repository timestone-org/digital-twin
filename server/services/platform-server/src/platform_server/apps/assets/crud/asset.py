"""素材行的数据访问。只做查询与写入，**不提交**——事务边界归 service 层。"""

import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lib.objectstore import ObjectStat
from platform_server.apps.assets.models import Asset, AssetModelVariant


@dataclass(frozen=True)
class AssetWrite:
    """落一行素材要的全套。

    ⚠ 打成一包不是为了好看：函数的形参上限是 5，而一行素材天然需要
    「谁、哪一类、叫什么、什么类型、多大、校验和」六件事。
    """

    asset_id: uuid.UUID
    kind: str
    name: str
    content_type: str
    size_bytes: int
    checksum: str
    created_by: str


async def insert_if_absent(session: AsyncSession, write: AssetWrite) -> None:
    """落一行；主键已存在即什么都不做。

    ⚠ 这是 finalize 幂等的落点，且是**真幂等**而不是「先查再插」：
    后者在两次并发 finalize 之间会双双查空、双双插入，第二条撞主键报 500。
    Args: session, write。
    """
    await session.execute(
        insert(Asset)
        .values(
            id=write.asset_id,
            kind=write.kind,
            name=write.name,
            content_type=write.content_type,
            size_bytes=write.size_bytes,
            checksum=write.checksum,
            created_by=write.created_by,
        )
        .on_conflict_do_nothing(index_elements=[Asset.id])
    )


async def get(session: AsyncSession, asset_id: uuid.UUID) -> Asset | None:
    """按 id 取一行；没有给 None。

    Args: session, asset_id。
    """
    return await session.get(Asset, asset_id)


# LIKE 的两个通配符与转义符自身。⚠ 不转义的话，搜「50%」会退化成「列全部」，
# 而现象只是「搜索好像没生效」——没有任何一处会报错
_LIKE_SPECIALS = str.maketrans({"\\": r"\\", "%": r"\%", "_": r"\_"})


def name_contains(text: str) -> str:
    """把用户输入的关键词裹成一个安全的 LIKE 模式。

    Args: text。
    """
    return f"%{text.translate(_LIKE_SPECIALS)}%"


async def list_by_kind(
    session: AsyncSession,
    *,
    kind: str | None,
    keyword: str | None,
    limit: int,
    offset: int,
) -> list[Asset]:
    """按类型与名字关键词列素材，新的在前。

    Args: session, kind（None = 全部）, keyword（None = 不筛）, limit, offset。
    """
    statement = select(Asset)
    if kind is not None:
        statement = statement.where(Asset.kind == kind)
    if keyword is not None:
        # ⚠ `ilike` 而不是 `like`：素材名里中英混排，大小写敏感的搜索会让用户
        # 搜「glb」搜不到自己刚传的「GLB」，而这在界面上与「没有这个素材」一样
        statement = statement.where(
            Asset.name.ilike(name_contains(keyword), escape="\\")
        )
    # ⚠ 第二排序键是主键：只按 created_at 排时，同一毫秒落库的两行在翻页之间
    # 顺序可以变，表现为某一条在两页里各出现一次而另一条一次都没有
    rows = await session.execute(
        statement.order_by(Asset.created_at.desc(), Asset.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(rows.scalars().all())


async def remove(session: AsyncSession, asset_id: uuid.UUID) -> None:
    """删一行。删不存在的行不是错误。

    Args: session, asset_id。
    """
    await session.execute(delete(Asset).where(Asset.id == asset_id))


async def rename(session: AsyncSession, asset_id: uuid.UUID, name: str) -> None:
    """改显示名。行在不在由 service 先判，这里只写。

    ⚠ 只动 name 一列：把整行 values 铺上去的话，某一次少传一个字段就会把它
    写成默认值，而被覆盖掉的是「字节的事实」那几列。
    Args: session, asset_id, name。
    """
    await session.execute(
        update(Asset).where(Asset.id == asset_id).values(name=name)
    )


@dataclass(frozen=True)
class ContentWrite:
    """一次独立拷贝的内容版本与上传凭证身份。"""

    upload_id: uuid.UUID
    revision: uuid.UUID
    stat: ObjectStat


async def switch_content(
    session: AsyncSession,
    asset_id: uuid.UUID,
    expected: str,
    write: ContentWrite,
) -> bool:
    """按原校验和切换版本，拒绝覆盖另一人的更新。

    Args: session, asset_id, expected, write。
    """
    result = await session.execute(
        update(Asset)
        .where(Asset.id == asset_id, Asset.checksum == expected)
        .values(
            content_revision=write.revision,
            content_upload_id=write.upload_id,
            content_type=write.stat.content_type,
            size_bytes=write.stat.size_bytes,
            checksum=write.stat.etag,
        )
        .returning(Asset.id)
    )
    return result.scalar_one_or_none() is not None


async def lock_revision(
    session: AsyncSession,
    asset_id: uuid.UUID,
    revision: uuid.UUID | None,
) -> bool:
    """发布压缩结果前锁定仍然有效的版本，仅覆盖短数据库事务。

    Args: session, asset_id, revision。
    """
    result = await session.execute(
        select(Asset.id)
        .where(Asset.id == asset_id, Asset.content_revision == revision)
        .with_for_update()
    )
    return result.scalar_one_or_none() is not None


async def model_content(
    session: AsyncSession,
    asset_id: uuid.UUID,
    variant: str,
) -> tuple[uuid.UUID | None, bool] | None:
    """在同一数据库快照内读取版本与档位状态。

    Args: session, asset_id, variant。
    """
    result = await session.execute(
        select(Asset.content_revision, AssetModelVariant.status)
        .outerjoin(
            AssetModelVariant,
            (AssetModelVariant.asset_id == Asset.id)
            & (AssetModelVariant.variant == variant),
        )
        .where(Asset.id == asset_id, Asset.kind == "model")
    )
    row = result.tuples().one_or_none()
    if row is None:
        return None
    revision, status = row
    return revision, status == "ready"
