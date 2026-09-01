"""运行与节点级执行记录的数据访问。"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.modeling.errors import RunAlreadyActive
from platform_server.apps.modeling.models import ModelingNodeRun, ModelingRun
from platform_server.apps.modeling.protocols import ACTIVE_RUN_STATUSES

# 运行列表按发起时间倒序，同刻按 id 定序
NEWEST_FIRST = (ModelingRun.created_at.desc(), ModelingRun.id.desc())
# 节点明细按拓扑序
BY_ORDINAL = (ModelingNodeRun.ordinal.asc(),)


class RunCrud(CrudBase[ModelingRun]):
    """`modeling_runs` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(ModelingRun)

    async def add_active(
        self, session: AsyncSession, run: ModelingRun
    ) -> ModelingRun:
        """插一条在途运行；同一条流水线已有在途的即 409。

        ⚠ 冲突是**数据库**判的（那条部分唯一索引），不是先查再插：先查再插在
        并发下会同时通过（docs/MODELING_DESIGN.md D17）。
        Args: session, run。
        """
        self.add(session, run)
        try:
            await session.flush()
        except IntegrityError as error:
            raise RunAlreadyActive(
                "这条流水线已经有一次运行在进行中"
            ) from error
        return run

    async def active_of(
        self, session: AsyncSession, pipeline_id: uuid.UUID
    ) -> ModelingRun | None:
        """一条流水线当前在途的那次运行。

        Args: session, pipeline_id。
        """
        rows = await session.execute(
            select(ModelingRun).where(
                ModelingRun.pipeline_id == pipeline_id,
                ModelingRun.status.in_(ACTIVE_RUN_STATUSES),
            )
        )
        return rows.scalars().first()

    async def page(
        self,
        session: AsyncSession,
        *,
        pipeline_id: uuid.UUID | None,
        offset: int,
        limit: int,
    ) -> tuple[list[ModelingRun], int]:
        """按流水线筛一页运行记录。

        Args: session, pipeline_id, offset, limit。
        """
        statement = select(ModelingRun)
        if pipeline_id is not None:
            statement = statement.where(ModelingRun.pipeline_id == pipeline_id)
        return await self.list_page(
            session,
            statement=statement.order_by(*NEWEST_FIRST),
            offset=offset,
            limit=limit,
        )

    async def stale_ids(
        self, session: AsyncSession, *, before: datetime, limit: int
    ) -> list[uuid.UUID]:
        """心跳陈旧、状态却还是在途的那些运行。

        ⚠ 它们是「执行者跑飞了」的唯一线索：不落终态的话，那条部分唯一索引会
        把这条流水线永久锁在「已有运行在途」上（§6.1 的 D17 补充）。
        Args: session, before, limit。
        """
        rows = await session.execute(
            select(ModelingRun.id)
            .where(
                ModelingRun.status.in_(ACTIVE_RUN_STATUSES),
                ModelingRun.heartbeat_at.is_not(None),
                ModelingRun.heartbeat_at < before,
            )
            .order_by(ModelingRun.heartbeat_at.asc())
            .limit(limit)
        )
        return list(rows.scalars().all())

    async def ids_beyond_keep(
        self,
        session: AsyncSession,
        *,
        pipeline_id: uuid.UUID,
        keep: int,
        exclude: frozenset[uuid.UUID],
    ) -> list[uuid.UUID]:
        """一条流水线里排在最近 `keep` 次之外的那些运行 id。

        ⚠ 已发布过模型版本的运行**既不入名单、也不占 `keep` 名额**：让它们参与
        计数只会把还想留着的那 20 次实验提前挤出去（§6.5）。
        ⚠ 排序带第二个键：同一时刻建的两条运行不定序时，分页边界会来回抖。
        Args: session, pipeline_id, keep, exclude。
        """
        statement = select(ModelingRun.id).where(
            ModelingRun.pipeline_id == pipeline_id
        )
        if exclude:
            statement = statement.where(ModelingRun.id.not_in(exclude))
        rows = await session.execute(
            statement.order_by(*NEWEST_FIRST).offset(max(0, keep))
        )
        return list(rows.scalars().all())

    async def expired_ids(
        self,
        session: AsyncSession,
        *,
        before: datetime,
        exclude: frozenset[uuid.UUID],
        limit: int,
    ) -> list[uuid.UUID]:
        """过了保留期的运行 id。已发布过的一律跳过。

        Args: session, before, exclude, limit。
        """
        statement = select(ModelingRun.id).where(
            ModelingRun.created_at < before
        )
        if exclude:
            statement = statement.where(ModelingRun.id.not_in(exclude))
        rows = await session.execute(
            statement.order_by(ModelingRun.created_at.asc()).limit(limit)
        )
        return list(rows.scalars().all())

    async def delete_by_ids(
        self, session: AsyncSession, run_ids: list[uuid.UUID]
    ) -> int:
        """按 id 批量删运行，回真实删掉的行数。空清单不发 SQL。

        Args: session, run_ids。
        """
        if not run_ids:
            return 0
        result = await session.execute(
            delete(ModelingRun).where(ModelingRun.id.in_(run_ids))
        )
        return int(getattr(result, "rowcount", 0) or 0)

    @staticmethod
    def touch(run: ModelingRun) -> None:
        """记一次心跳。执行者每跑完一个节点调一次。

        Args: run。
        """
        run.heartbeat_at = datetime.now(UTC)


class NodeRunCrud(CrudBase[ModelingNodeRun]):
    """`modeling_node_runs` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(ModelingNodeRun)

    async def list_by_run(
        self, session: AsyncSession, run_id: uuid.UUID
    ) -> list[ModelingNodeRun]:
        """一次运行的全部节点记录，按拓扑序。

        Args: session, run_id。
        """
        rows = await session.execute(
            select(ModelingNodeRun)
            .where(ModelingNodeRun.run_id == run_id)
            .order_by(*BY_ORDINAL)
        )
        return list(rows.scalars().all())

    async def get_node(
        self, session: AsyncSession, *, run_id: uuid.UUID, node_id: str
    ) -> ModelingNodeRun | None:
        """一次运行里某个节点的记录。

        Args: session, run_id, node_id。
        """
        rows = await session.execute(
            select(ModelingNodeRun).where(
                ModelingNodeRun.run_id == run_id,
                ModelingNodeRun.node_id == node_id,
            )
        )
        return rows.scalars().first()

    async def delete_by_run(
        self, session: AsyncSession, run_id: uuid.UUID
    ) -> int:
        """清掉一次运行的全部节点记录，回删了几条。

        Args: session, run_id。
        """
        result = await session.execute(
            delete(ModelingNodeRun).where(ModelingNodeRun.run_id == run_id)
        )
        return int(getattr(result, "rowcount", 0) or 0)


run_crud = RunCrud()
node_run_crud = NodeRunCrud()
