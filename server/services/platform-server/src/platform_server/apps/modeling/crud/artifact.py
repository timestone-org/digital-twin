"""模型版本产物的数据访问。一个版本至多一份，故只有建与查。"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.modeling.models import ModelingModelArtifact


class ModelArtifactCrud(CrudBase[ModelingModelArtifact]):
    """`modeling_model_artifacts` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(ModelingModelArtifact)

    async def get_by_version(
        self, session: AsyncSession, version_id: uuid.UUID
    ) -> ModelingModelArtifact | None:
        """这个版本的产物；通道 A 的版本给 None。

        Args: session, version_id。
        """
        rows = await session.execute(
            select(ModelingModelArtifact).where(
                ModelingModelArtifact.model_version_id == version_id
            )
        )
        return rows.scalars().first()


model_artifact_crud = ModelArtifactCrud()
