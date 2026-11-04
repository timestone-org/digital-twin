"""工作流批量管理复用的单项删除与定时权限保护。"""

import uuid

import httpx
import pytest
from conftest import SignHeaders
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_helpers import (
    PIPELINES,
    RUNS,
    create_pipeline,
    data_of,
    linear_graph,
)
from platform_server.apps.modeling.models import ModelingRun

pytestmark = pytest.mark.requires_postgres


@pytest.mark.parametrize(
    ("run_status", "publication_status"),
    [
        ("pending", None),
        ("running", None),
        ("cancelling", None),
        ("succeeded", "pending"),
    ],
)
async def test_workflow_deletion_preserves_unfinished_training(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    run_status: str,
    publication_status: str | None,
) -> None:
    pipeline = await create_pipeline(
        app_client, "delete-unfinished", linear_graph("unused-data")
    )
    run = ModelingRun(
        pipeline_id=uuid.UUID(pipeline["id"]),
        status=run_status,
        publication_status=publication_status,
        graph_snapshot={},
        trigger="manual",
    )
    db_session.add(run)
    await db_session.commit()
    response = await app_client.delete(f"{PIPELINES}/{pipeline['id']}")
    assert response.status_code == 409, response.text
    assert (
        await app_client.get(f"{PIPELINES}/{pipeline['id']}")
    ).status_code == 200
    assert data_of(await app_client.get(f"{RUNS}/{run.id}"))["status"] == (
        run_status
    )


async def test_training_user_can_disable_automatic_publication_schedule(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    pipeline = await create_pipeline(
        app_client, "disable-auto-publication", linear_graph("unused-data")
    )
    url = f"{PIPELINES}/{pipeline['id']}/schedule"
    created = await app_client.put(
        url,
        json={
            "is_enabled": True,
            "interval_minutes": 60,
            "auto_publish": True,
            "expected_revision": 0,
        },
    )
    assert created.status_code == 200, created.text
    headers = sign(("modeling:view", "modeling:run"))
    disabled = await app_client.put(
        url,
        json={
            "is_enabled": False,
            "interval_minutes": 60,
            "auto_publish": True,
            "expected_revision": data_of(created)["revision"],
        },
        headers=headers,
    )
    assert disabled.status_code == 200, disabled.text
    saved = data_of(await app_client.get(url, headers=headers))
    assert saved["is_enabled"] is False
    assert saved["auto_publish"] is True
    assert saved["interval_minutes"] == 60
    assert saved["next_run_at"] is None
    denied = await app_client.put(
        url,
        json={
            "is_enabled": True,
            "interval_minutes": 60,
            "auto_publish": True,
            "expected_revision": saved["revision"],
        },
        headers=headers,
    )
    assert denied.status_code == 403
