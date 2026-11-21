"""覆盖行的数据访问。只做查询与写入，**不提交**——事务边界归 service 层。"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.runtime_params.catalog import ParamValue
from platform_server.apps.runtime_params.models import RuntimeParamOverride


@dataclass(frozen=True)
class OverrideWrite:
    """一次运行参数覆盖的前后值与修改者快照。"""

    section: str
    key: str
    value: ParamValue
    previous: ParamValue
    actor: str
    actor_name: str | None
    updated_at: datetime


async def list_section(
    session: AsyncSession, section: str
) -> list[RuntimeParamOverride]:
    """一个分组下全部覆盖行，按键升序。

    Args: session, section。
    """
    rows = await session.execute(
        select(RuntimeParamOverride)
        .where(RuntimeParamOverride.section == section)
        .order_by(RuntimeParamOverride.key)
        # 核心层 upsert 不会刷新本次请求先读过的 ORM 实例。
        .execution_options(populate_existing=True)
    )
    return list(rows.scalars().all())


async def write_time(session: AsyncSession) -> datetime:
    """读取当前 PostgreSQL 事务的时间。"""
    result = await session.execute(select(func.now()))
    return result.scalar_one()


async def upsert(session: AsyncSession, write: OverrideWrite) -> None:
    """写入或改写一行覆盖。

    ⚠ 走 `ON CONFLICT` 而不是「先查再插」：同一项被两个人同时改时，
    先查再插的那条会撞复合主键，用户看到的是 500。
    ⚠ `updated_at` 要在 `set_` 里显式推进：`onupdate` 是 ORM 层的钩子，
    核心层的 upsert 走不到它，不写就永远停在第一次覆盖的时刻。
    Args: session, write。
    """
    name_at = write.updated_at if write.actor_name is not None else None
    statement = (
        insert(RuntimeParamOverride)
        .values(
            section=write.section,
            key=write.key,
            value_json=write.value,
            previous_value_json=write.previous,
            updated_by=write.actor,
            updated_by_name=write.actor_name,
            updated_by_name_at=name_at,
            updated_at=write.updated_at,
        )
        .on_conflict_do_update(
            index_elements=[
                RuntimeParamOverride.section,
                RuntimeParamOverride.key,
            ],
            set_={
                "value_json": write.value,
                "previous_value_json": write.previous,
                "updated_by": write.actor,
                "updated_by_name": write.actor_name,
                "updated_by_name_at": name_at,
                "updated_at": write.updated_at,
            },
        )
    )
    await session.execute(statement)


async def remove(session: AsyncSession, *, section: str, key: str) -> None:
    """删掉一项的覆盖行，此后该项重新跟随环境变量。

    Args: session, section, key。
    """
    await session.execute(
        delete(RuntimeParamOverride).where(
            RuntimeParamOverride.section == section,
            RuntimeParamOverride.key == key,
        )
    )


async def remove_section(session: AsyncSession, section: str) -> None:
    """删掉一个分组的全部覆盖行。

    ⚠ 连目录里已经下线的键也一并删掉：那些行读不出来也改不动，留着只会在
    下一次有人恢复同名键时突然生效。
    Args: session, section。
    """
    await session.execute(
        delete(RuntimeParamOverride).where(
            RuntimeParamOverride.section == section
        )
    )
