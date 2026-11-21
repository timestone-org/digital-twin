"""管理平台来源的元数据和解绑，保留已经登记的知识资料。"""

import uuid

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.errors import (
    SourceIdentityInUse,
    SourceNotEditable,
    SourceNotFound,
)
from knowledge_server.apps.knowledge.models import KnowledgeSource
from knowledge_server.apps.knowledge.schemas import SourceOut
from knowledge_server.apps.knowledge.schemas.source_config import (
    PlatformSourceConfig,
)
from knowledge_server.apps.knowledge.schemas.source_patch import (
    SourceMetadataIn,
)
from knowledge_server.apps.knowledge.services.library_service import source_out
from knowledge_server.apps.knowledge.services.sources import PLATFORM_KIND
from lib.errors import ValidationFailed
from lib.utils.timeutils import utcnow


async def _platform_source(
    session: AsyncSession, source_id: uuid.UUID
) -> KnowledgeSource:
    row = await crud.source.get_source(
        session, source_id, is_locked=True, should_include_detached=True
    )
    if row is None:
        raise SourceNotFound("平台来源不存在")
    if row.kind != PLATFORM_KIND:
        raise SourceNotEditable("上传来源随知识库管理")
    return row


def _identity(config: PlatformSourceConfig) -> tuple[str, str]:
    return config.path, config.id_field or "row_id"


async def update(
    session: AsyncSession,
    source_id: uuid.UUID,
    fields: SourceMetadataIn,
) -> SourceOut:
    """更新名称和指定的配置字段。Args: session, source_id, fields。"""
    row = await _platform_source(session, source_id)
    if row.detached_at is not None:
        raise SourceNotFound("平台来源已解绑")
    if fields.config is not None:
        changes = fields.config.model_dump(exclude_unset=True)
        try:
            before = PlatformSourceConfig.model_validate(row.config_json)
            after = PlatformSourceConfig.model_validate(
                {**before.model_dump(), **changes}
            )
        except ValidationError as error:
            raise ValidationFailed(
                "平台来源配置无效，请检查路径与字段"
            ) from error
        if _identity(before) != _identity(
            after
        ) and await crud.source.has_imported(session, source_id):
            raise SourceIdentityInUse(
                "该来源已经导入资料，请新建来源以更换路径或记录标识字段"
            )
        if before != after:
            row.config_json = after.model_dump()
            row.sync_cursor = None
            row.last_error = ""
    if fields.name is not None:
        row.name = fields.name
    await session.flush()
    return source_out(row)


async def detach(session: AsyncSession, source_id: uuid.UUID) -> None:
    """停止该来源后续同步，原文与引用仍可读。Args: session, source_id。"""
    row = await _platform_source(session, source_id)
    if row.detached_at is None:
        row.detached_at = utcnow()
        # 旧读取者只识别顶层 path，解绑后也不能继续访问上游。
        row.config_json = {"last_active_config": dict(row.config_json)}
        await session.flush()
