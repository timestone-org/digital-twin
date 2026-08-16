"""覆盖行的数据访问。只做查询与写入，**不提交**——事务边界归 service 层。"""

from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.runtime_params.catalog import ParamValue
from platform_server.apps.runtime_params.models import RuntimeParamOverride


@dataclass(frozen=True)
class OverrideWrite:
    """写一行覆盖要的全套。

    ⚠ 打成一包不是为了好看：函数的形参上限是 5，而一行覆盖天然需要
    「哪一组的哪一项、改成多少、此前多少、谁改的」五件事。
    """

    section: str
    key: str
    value: ParamValue
    previous: ParamValue
    actor: str


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
    )
    return list(rows.scalars().all())


async def upsert(session: AsyncSession, write: OverrideWrite) -> None:
    """写入或改写一行覆盖。

    ⚠ 走 `ON CONFLICT` 而不是「先查再插」：同一项被两个人同时改时，
    先查再插的那条会撞复合主键，用户看到的是 500。
    ⚠ `updated_at` 要在 `set_` 里显式推进：`onupdate` 是 ORM 层的钩子，
    核心层的 upsert 走不到它，不写就永远停在第一次覆盖的时刻。
    Args: session, write。
    """
    statement = (
        insert(RuntimeParamOverride)
        .values(
            section=write.section,
            key=write.key,
            value_json=write.value,
            previous_value_json=write.previous,
            updated_by=write.actor,
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
                "updated_at": func.now(),
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
