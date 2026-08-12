"""实例数据访问。"""

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from opcua_server.apps.instance.models import Instance

SORTABLE = {
    "name": Instance.name,
    "port": Instance.port,
    "created_at": Instance.created_at,
}
DEFAULT_ORDER = (Instance.name.asc(),)


class InstanceCrud(CrudBase[Instance]):
    """`opcua_instances` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(Instance)

    async def get_by_name(
        self, session: AsyncSession, name: str
    ) -> Instance | None:
        """按实例名取实例。名称唯一，是人在页面上指认它的方式。

        Args: session, name。
        """
        result = await session.execute(
            select(Instance).where(Instance.name == name)
        )
        return result.scalars().one_or_none()

    async def get_by_port(
        self, session: AsyncSession, port: int
    ) -> Instance | None:
        """按端口取实例。端口唯一——它是实例之间唯一的硬隔离。

        Args: session, port。
        """
        result = await session.execute(
            select(Instance).where(Instance.port == port)
        )
        return result.scalars().one_or_none()

    async def taken_ports(self, session: AsyncSession) -> frozenset[int]:
        """已被占用的端口集合，供 service 层从池里挑一个空的。

        ⚠ 这只是「挑」的依据，不是并发下的保证：真正防重复的是
        `uq_opcua_instances_port`。先查再插在并发下必然重复。

        Args: session。
        """
        result = await session.execute(select(Instance.port))
        return frozenset(result.scalars().all())

    async def count_all(self, session: AsyncSession) -> int:
        """实例总数，用于判定是否已达单进程上限。

        Args: session。
        """
        result = await session.execute(
            select(func.count()).select_from(Instance)
        )
        return int(result.scalar_one())

    async def autostart_set(self, session: AsyncSession) -> list[Instance]:
        """开机自启的实例，进程启动时按它拉起。

        Args: session。
        """
        result = await session.execute(
            select(Instance)
            .where(Instance.is_autostart)
            .order_by(Instance.name.asc())
        )
        return list(result.scalars().all())

    @staticmethod
    def build_query(*, keyword: str | None) -> Select[tuple[Instance]]:
        """按关键字构造列表查询。

        Args: keyword。
        """
        statement = select(Instance)
        if keyword:
            pattern = f"%{keyword.lower()}%"
            statement = statement.where(func.lower(Instance.name).like(pattern))
        return statement


instance_crud = InstanceCrud()
