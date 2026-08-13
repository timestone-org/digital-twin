"""模型、工件与折外预测的数据访问。"""

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.hvac.models import (
    AcModel,
    AcModelArtifact,
    AcModelPrediction,
)


class AcModelCrud(CrudBase[AcModel]):
    """`hvac_ac_models` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(AcModel)

    async def get_by_name(
        self, session: AsyncSession, *, room_id: uuid.UUID, name: str
    ) -> AcModel | None:
        """按房间与名字取一个模型（自然键查重用）。

        Args: session, room_id, name。
        """
        result = await session.execute(
            select(AcModel)
            .where(AcModel.room_id == room_id)
            .where(AcModel.name == name)
        )
        return result.scalar_one_or_none()

    async def lock(
        self, session: AsyncSession, model_id: uuid.UUID
    ) -> AcModel | None:
        """取一个模型并把它这一行锁到事务结束。

        ⚠ 训练收尾与人改配置可能同时到：不锁行，两边交错写会留下
        「新配置配着旧评估」的行。
        Args: session, model_id。
        """
        result = await session.execute(
            select(AcModel).where(AcModel.id == model_id).with_for_update()
        )
        return result.scalar_one_or_none()


class AcModelArtifactCrud(CrudBase[AcModelArtifact]):
    """`hvac_ac_model_artifacts` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(AcModelArtifact)

    async def put(
        self, session: AsyncSession, artifact: AcModelArtifact
    ) -> None:
        """覆盖式写入一个模型的工件（一个模型只有一份）。

        Args: session, artifact。
        """
        found = await session.get(AcModelArtifact, artifact.model_id)
        if found is not None:
            await session.delete(found)
            await session.flush()
        session.add(artifact)
        await session.flush()


class AcModelPredictionCrud(CrudBase[AcModelPrediction]):
    """`hvac_ac_model_predictions` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(AcModelPrediction)

    async def replace_all(
        self,
        session: AsyncSession,
        *,
        model_id: uuid.UUID,
        rows: Sequence[AcModelPrediction],
    ) -> None:
        """整体换掉一个模型的折外预测（派生数据，随训练一起重生）。

        Args: session, model_id, rows。
        """
        await session.execute(
            delete(AcModelPrediction).where(
                AcModelPrediction.model_id == model_id
            )
        )
        session.add_all(rows)
        await session.flush()

    async def page(
        self,
        session: AsyncSession,
        *,
        model_id: uuid.UUID,
        running_set: Sequence[str] | None,
        offset: int,
        limit: int,
    ) -> list[AcModelPrediction]:
        """按起始时刻倒序取一页。

        页码分页而不是游标：折外预测是训练时整体替换的有界快照，不是
        追加型时序流，页码不会重复漏行（api-contract §5.1 的「有限集合」）。
        Args: session, model_id, running_set, offset, limit。
        """
        statement: Select[tuple[AcModelPrediction]] = (
            select(AcModelPrediction)
            .where(AcModelPrediction.model_id == model_id)
            .order_by(AcModelPrediction.started_at.desc())
            .offset(offset)
            .limit(limit)
        )
        if running_set is not None:
            statement = statement.where(
                AcModelPrediction.running_set == sorted(running_set)
            )
        result = await session.execute(statement)
        return list(result.scalars().all())

    async def count_matching(
        self,
        session: AsyncSession,
        *,
        model_id: uuid.UUID,
        running_set: Sequence[str] | None,
    ) -> int:
        """一个模型（可按组合过滤）的折外预测总数。

        Args: session, model_id, running_set。
        """
        statement = (
            select(func.count())
            .select_from(AcModelPrediction)
            .where(AcModelPrediction.model_id == model_id)
        )
        if running_set is not None:
            statement = statement.where(
                AcModelPrediction.running_set == sorted(running_set)
            )
        result = await session.execute(statement)
        return int(result.scalar_one())


ac_model_crud = AcModelCrud()
ac_model_artifact_crud = AcModelArtifactCrud()
ac_model_prediction_crud = AcModelPredictionCrud()
