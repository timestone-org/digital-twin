"""数据源绑定与达标范围的数据访问。"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.hvac.models import AcDataBinding, AcMetricLimit


class AcDataBindingCrud(CrudBase[AcDataBinding]):
    """`hvac_ac_data_bindings` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(AcDataBinding)

    async def list_by_ac_unit(
        self, session: AsyncSession, ac_unit_id: uuid.UUID
    ) -> list[AcDataBinding]:
        """一台空调的全部绑定，按数据集名排序。

        Args: session, ac_unit_id。
        """
        result = await session.execute(
            select(AcDataBinding)
            .where(AcDataBinding.ac_unit_id == ac_unit_id)
            .order_by(AcDataBinding.dataset.asc())
        )
        return list(result.scalars().all())

    async def find(
        self, session: AsyncSession, ac_unit_id: uuid.UUID, dataset: str
    ) -> AcDataBinding | None:
        """取一台空调某个数据集的绑定，没有就给 None。

        Args: session, ac_unit_id, dataset。
        """
        result = await session.execute(
            select(AcDataBinding).where(
                AcDataBinding.ac_unit_id == ac_unit_id,
                AcDataBinding.dataset == dataset,
            )
        )
        return result.scalar_one_or_none()


class AcMetricLimitCrud(CrudBase[AcMetricLimit]):
    """`hvac_ac_metric_limits` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(AcMetricLimit)

    async def list_by_ac_unit(
        self, session: AsyncSession, ac_unit_id: uuid.UUID
    ) -> list[AcMetricLimit]:
        """一台空调的全部达标范围，按指标名排序。

        Args: session, ac_unit_id。
        """
        result = await session.execute(
            select(AcMetricLimit)
            .where(AcMetricLimit.ac_unit_id == ac_unit_id)
            .order_by(AcMetricLimit.metric.asc())
        )
        return list(result.scalars().all())


ac_data_binding_crud = AcDataBindingCrud()
ac_metric_limit_crud = AcMetricLimitCrud()
