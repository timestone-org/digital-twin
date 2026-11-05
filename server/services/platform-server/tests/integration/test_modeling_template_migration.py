"""模板来源扩展兼容旧读写；已有独立快照时拒绝数据库收缩。"""

import uuid

import httpx
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from contract.test_modeling_migration_phases import load_migration
from pydantic import BaseModel
from sqlalchemy import Connection, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_helpers import PIPELINES, data_of
from integration.test_modeling_templates import TEMPLATES, make_template
from platform_server.apps.modeling.models import ModelingPipeline

pytestmark = pytest.mark.requires_postgres
REVISION = "modeling_template_src_20261105"


class LegacyTemplateSource(BaseModel):
    """独立模板发布前的来源读取契约。"""

    pipeline_id: uuid.UUID
    code: str
    version: int


def apply_migration(connection: Connection, direction: str) -> None:
    """在测试事务中执行真实迁移函数；Args: connection, direction。"""
    migration = load_migration(REVISION)
    with Operations.context(MigrationContext.configure(connection)):
        getattr(migration, direction)()


async def test_expansion_keeps_existing_templates_and_legacy_readers_working(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    template = await make_template(app_client)
    connection = await db_session.connection()
    await connection.run_sync(apply_migration, "downgrade")
    before = LegacyTemplateSource.model_validate(template)
    await connection.run_sync(apply_migration, "upgrade")
    detail = data_of(await app_client.get(f"{TEMPLATES}/{template['id']}"))
    assert LegacyTemplateSource.model_validate(detail) == before
    second = await app_client.post(
        TEMPLATES,
        json={"pipeline_id": template["pipeline_id"], "name": "扩展后旧写入"},
    )
    assert second.status_code == 201, second.text
    legacy = LegacyTemplateSource.model_validate(data_of(second))
    assert legacy.pipeline_id == before.pipeline_id
    assert legacy.version == before.version + 1


async def test_detached_snapshot_prevents_contract_shrinking(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    template = await make_template(app_client)
    deleted = await app_client.delete(f"{PIPELINES}/{template['pipeline_id']}")
    assert deleted.status_code == 204, deleted.text
    connection = await db_session.connection()
    with pytest.raises(RuntimeError, match="已有独立模板"):
        await connection.run_sync(apply_migration, "downgrade")
    detail = data_of(await app_client.get(f"{TEMPLATES}/{template['id']}"))
    assert detail["pipeline_id"] is None


async def test_source_foreign_key_still_rejects_implicit_cascade(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    template = await make_template(app_client)
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            await db_session.execute(
                delete(ModelingPipeline).where(
                    ModelingPipeline.id
                    == uuid.UUID(str(template["pipeline_id"]))
                )
            )
    persisted = data_of(await app_client.get(f"{TEMPLATES}/{template['id']}"))
    assert persisted == template
