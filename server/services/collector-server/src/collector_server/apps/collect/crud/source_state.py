"""运行态表的数据访问。事务归 service 层，本层不提交。"""

from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from collector_server.apps.collect.models.source_state import SourceState
from collector_server.apps.collect.runtime.session import SourceStatus


class SourceStateCrud:
    """`collect_source_states` 的数据访问。"""

    async def upsert(
        self, session: AsyncSession, status: SourceStatus, *, instance: str
    ) -> None:
        """按数据源覆盖写一行运行态。

        ⚠ 走 `ON CONFLICT` 而不是「先查再插」：后者在并发下必然重复，而这里
        的并发来源是租约切换时新旧 leader 的重叠窗口。

        Args: session, status, instance。
        """
        values = {
            "source_id": status.source_id,
            "state": status.state,
            "point_count": status.point_count,
            "error_category": status.error_category,
            "error_detail": status.error_detail,
            "leader_instance": instance,
        }
        statement = insert(SourceState).values(**values)
        # SQLAlchemy 的 `set_` 收的是列表达式，形状由它自己定义，止步于本行
        updated: dict[str, Any] = {
            name: statement.excluded[name]
            for name in values
            if name != "source_id"
        }
        # ⚠ `onupdate` 只在 ORM 的 UPDATE 上生效，ON CONFLICT 走不到它：不显式
        # 写这一句，一行「三天前就 offline」的记录看起来会像刚刚才写的
        updated["updated_at"] = func.now()
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[SourceState.source_id], set_=updated
            )
        )
