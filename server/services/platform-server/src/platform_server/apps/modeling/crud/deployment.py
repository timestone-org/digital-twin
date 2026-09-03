"""部署、密钥与调用记录的数据访问。"""

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.modeling.models import (
    ModelingApiKey,
    ModelingCallLog,
    ModelingDeployment,
)

# 从这个状态码起算「这次调用失败了」
_FAILED_FROM = 400

DEPLOYMENT_ORDER = (
    ModelingDeployment.created_at.desc(),
    ModelingDeployment.id.desc(),
)
KEY_ORDER = (ModelingApiKey.created_at.desc(), ModelingApiKey.id.desc())


class DeploymentCrud(CrudBase[ModelingDeployment]):
    """`modeling_deployments` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(ModelingDeployment)

    async def get_by_code(
        self, session: AsyncSession, code: str
    ) -> ModelingDeployment | None:
        """按对外标识取部署。**对外面每次调用就查这一次。**

        Args: session, code。
        """
        rows = await session.execute(
            select(ModelingDeployment).where(ModelingDeployment.code == code)
        )
        return rows.scalars().first()

    async def list_all(self, session: AsyncSession) -> list[ModelingDeployment]:
        """全部部署，最新的在前。

        Args: session。
        """
        rows = await session.execute(
            select(ModelingDeployment).order_by(*DEPLOYMENT_ORDER)
        )
        return list(rows.scalars().all())

    async def count_by_version(
        self, session: AsyncSession, version_id: uuid.UUID
    ) -> int:
        """这个版本被几个部署钉着。退役前问一句。

        Args: session, version_id。
        """
        rows = await session.execute(
            select(func.count())
            .select_from(ModelingDeployment)
            .where(ModelingDeployment.model_version_id == version_id)
        )
        return int(rows.scalar_one())


class ApiKeyCrud(CrudBase[ModelingApiKey]):
    """`modeling_api_keys` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(ModelingApiKey)

    async def get_by_digest(
        self, session: AsyncSession, digest: str
    ) -> ModelingApiKey | None:
        """按摘要取那一把。

        ⚠ 摘要上有唯一约束，所以这是一次索引点查，不是遍历这个部署的每一把。
        Args: session, digest。
        """
        rows = await session.execute(
            select(ModelingApiKey).where(ModelingApiKey.key_hash == digest)
        )
        return rows.scalars().first()

    async def list_by_deployment(
        self, session: AsyncSession, deployment_id: uuid.UUID
    ) -> list[ModelingApiKey]:
        """一个部署下的全部密钥，最新的在前。

        Args: session, deployment_id。
        """
        rows = await session.execute(
            select(ModelingApiKey)
            .where(ModelingApiKey.deployment_id == deployment_id)
            .order_by(*KEY_ORDER)
        )
        return list(rows.scalars().all())


class CallLogCrud(CrudBase[ModelingCallLog]):
    """`modeling_call_logs` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(ModelingCallLog)

    async def daily_counts(
        self,
        session: AsyncSession,
        deployment_id: uuid.UUID,
        since: datetime,
    ) -> list[tuple[datetime, int, int]]:
        """按天聚合的调用量与出错量。

        ⚠ 聚合在库里做：几万行拉回进程再分组，一次翻页就把内存吃满。
        Args: session, deployment_id, since。
        """
        day = func.date_trunc("day", ModelingCallLog.created_at)
        rows = await session.execute(
            select(
                day.label("day"),
                func.count().label("total"),
                func.count()
                .filter(ModelingCallLog.status >= _FAILED_FROM)
                .label("failed"),
            )
            .where(ModelingCallLog.deployment_id == deployment_id)
            .where(ModelingCallLog.created_at >= since)
            .group_by(day)
            .order_by(day.desc())
        )
        return [
            (row.day, int(row.total), int(row.failed)) for row in rows.all()
        ]


deployment_crud = DeploymentCrud()
api_key_crud = ApiKeyCrud()
call_log_crud = CallLogCrud()
