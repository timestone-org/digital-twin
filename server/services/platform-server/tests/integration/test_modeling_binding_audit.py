"""绑定的建、换、停、删都留操作审计：它们改的是每一张用这条公式的台账的数。"""

import uuid

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.modeling_helpers import create_pipeline, data_of, linear_graph
from integration.test_modeling_api import _run_pipeline, _seed_ledger
from integration.test_modeling_formula_seam import (
    BINDINGS,
    LOAD,
    TEMPERATURE,
    _library_entry,
    _publish,
)
from platform_server.apps.modeling.models.template import (
    ModelingConfigurationAudit,
)

pytestmark = pytest.mark.requires_postgres


async def _audits_of(
    session: AsyncSession, target: str
) -> list[ModelingConfigurationAudit]:
    """这条绑定上的审计，按写入先后。

    Args: session, target。
    """
    return list(
        await session.scalars(
            select(ModelingConfigurationAudit)
            .where(ModelingConfigurationAudit.target_id == uuid.UUID(target))
            .order_by(
                ModelingConfigurationAudit.created_at,
                ModelingConfigurationAudit.id,
            )
        )
    )


async def test_every_binding_change_leaves_an_audit_row(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    await _seed_ledger(app_client, db_session, "energy_bindaudit")
    pipeline = await create_pipeline(
        app_client, "bindaudit", linear_graph("energy_bindaudit")
    )
    run = await _run_pipeline(app_client, worker_sessions, pipeline["id"])
    first = await _publish(app_client, run["id"], "第一版")
    again = await _run_pipeline(app_client, worker_sessions, pipeline["id"])
    second = await _publish(app_client, again["id"], "第二版")
    await _library_entry(app_client, "审计模型", [TEMPERATURE, LOAD])
    binding = data_of(
        await app_client.post(
            BINDINGS,
            json={"fx_code": "审计模型", "model_version_id": first["id"]},
        )
    )
    url = f"{BINDINGS}/{binding['id']}"
    await app_client.patch(url, json={"model_version_id": second["id"]})
    await app_client.patch(url, json={"is_enabled": False})
    deleted = await app_client.delete(url)
    assert deleted.status_code == 204, deleted.text
    audits = await _audits_of(db_session, binding["id"])
    assert [item.action for item in audits] == [
        "binding_created",
        "binding_rebound",
        "binding_toggled",
        "binding_deleted",
    ]
    assert {item.actor_id for item in audits} == {
        app_client.headers["X-Auth-User-Id"]
    }
    rebound = audits[1]
    assert rebound.before_json == {"model_version_id": first["id"]}
    assert rebound.after_json == {"model_version_id": second["id"]}
