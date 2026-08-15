"""发布配置与组合时间点位的数据访问。"""

import uuid
from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.hvac.models import (
    AcModelPublication,
    AcModelSetBinding,
)


class AcModelPublicationCrud(CrudBase[AcModelPublication]):
    """`hvac_ac_model_publications` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(AcModelPublication)

    async def find(
        self, session: AsyncSession, model_id: uuid.UUID
    ) -> AcModelPublication | None:
        """取一个模型的发布配置；没配过给 None。

        Args: session, model_id。
        """
        return await session.get(AcModelPublication, model_id)

    async def list_enabled(
        self, session: AsyncSession
    ) -> list[AcModelPublication]:
        """全部已启用的发布配置，按模型 id 升序。

        ⚠ 排序是为了让发布循环每一拍走同一个次序：不排序时「一拍的时间预算
        用完了、剩下的下一拍再说」会永远轮不到同几个模型。

        Args: session。
        """
        result = await session.execute(
            select(AcModelPublication)
            .where(AcModelPublication.is_enabled)
            .order_by(AcModelPublication.model_id.asc())
        )
        return list(result.scalars().all())

    async def delete_by_model(
        self, session: AsyncSession, model_id: uuid.UUID
    ) -> bool:
        """解绑，返回本来配没配过。组合绑定随复合外键 CASCADE 一起走。

        Args: session, model_id。
        """
        found = await session.get(AcModelPublication, model_id)
        if found is None:
            return False
        await session.delete(found)
        await session.flush()
        return True


class AcModelSetBindingCrud(CrudBase[AcModelSetBinding]):
    """`hvac_ac_model_set_bindings` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(AcModelSetBinding)

    async def list_of_model(
        self, session: AsyncSession, model_id: uuid.UUID
    ) -> list[AcModelSetBinding]:
        """一个模型的全部组合绑定，按 `set_key` 升序。

        Args: session, model_id。
        """
        result = await session.execute(
            select(AcModelSetBinding)
            .where(AcModelSetBinding.model_id == model_id)
            .order_by(AcModelSetBinding.set_key.asc())
        )
        return list(result.scalars().all())

    async def list_of_models(
        self, session: AsyncSession, model_ids: Sequence[uuid.UUID]
    ) -> list[AcModelSetBinding]:
        """一批模型的全部组合绑定。

        ⚠ 发布循环一拍要处理多个模型，逐个回查就是 N+1，而它每分钟跑一次。

        Args: session, model_ids。
        """
        if not model_ids:
            return []
        result = await session.execute(
            select(AcModelSetBinding)
            .where(AcModelSetBinding.model_id.in_(set(model_ids)))
            .order_by(AcModelSetBinding.set_key.asc())
        )
        return list(result.scalars().all())

    async def clear(self, session: AsyncSession, model_id: uuid.UUID) -> None:
        """删光一个模型的组合绑定。

        ⚠ 改实例之前必须先调它：复合外键指着「模型 + 实例」，实例先变会让
        旧绑定当场违反外键。

        Args: session, model_id。
        """
        await session.execute(
            delete(AcModelSetBinding).where(
                AcModelSetBinding.model_id == model_id
            )
        )
        await session.flush()

    async def add_all(
        self, session: AsyncSession, rows: Sequence[AcModelSetBinding]
    ) -> None:
        """挂上一批组合绑定。

        Args: session, rows。
        """
        session.add_all(rows)


ac_model_publication_crud = AcModelPublicationCrud()
ac_model_set_binding_crud = AcModelSetBindingCrud()
