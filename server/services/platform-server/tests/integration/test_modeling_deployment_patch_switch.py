"""部署编辑与专用换版共用的 HTTP、修订和审计契约。"""

import uuid

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_helpers import data_of
from integration.modeling_management_helpers import (
    seed_rule_versions,
    seed_versions,
)
from integration.test_modeling_deployment_switches import DEPLOYMENTS, deployed
from platform_server.apps.modeling.models import ModelingConfigurationAudit


async def test_patch_changes_version_and_metadata_in_one_audited_revision(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    source, target = versions
    original = await deployed(app_client, source)
    path = f"{DEPLOYMENTS}/{original['id']}"
    body = {
        "expected_revision": 1,
        "model_version_id": target,
        "name": "已批准",
    }
    changed = await app_client.patch(path, json=body)
    assert changed.status_code == 200, changed.text
    result = data_of(changed)
    assert (result["model_version_id"], result["name"], result["revision"]) == (
        target,
        "已批准",
        2,
    )
    history = data_of(await app_client.get(f"{path}/switches"))["items"]
    assert len(history) == 1
    assert history[0]["from_model_version_id"] == source
    assert history[0]["to_model_version_id"] == target
    assert history[0]["revision"] == 2
    assert history[0]["created_by_name"] == "测试员"
    audit = (
        await db_session.scalars(
            select(ModelingConfigurationAudit).where(
                ModelingConfigurationAudit.target_id
                == uuid.UUID(original["id"])
            )
        )
    ).one()
    assert audit.action == "deployment_version_switched"
    assert audit.actor_id == app_client.headers["X-Auth-User-Id"]
    assert audit.source_ip == "127.0.0.1"
    assert audit.before_json == {"model_version_id": source}
    assert audit.after_json == {"model_version_id": target, "revision": 2}


async def test_patch_requires_a_current_revision_before_repinning(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    source, target = versions
    original = await deployed(app_client, source)
    path = f"{DEPLOYMENTS}/{original['id']}"
    legacy = await app_client.patch(
        path, json={"model_version_id": source, "name": "旧表单"}
    )
    assert legacy.status_code == 200
    assert legacy.headers["Deprecation"] == "true"
    assert data_of(legacy)["revision"] == 2
    body = {"model_version_id": target, "name": "尚未批准"}
    for patch in (body, {**body, "expected_revision": 1}):
        rejected = await app_client.patch(path, json=patch)
        assert rejected.status_code == 409
        assert rejected.json()["code"] == 41433
    assert data_of(await app_client.get(path))["name"] == "旧表单"
    assert data_of(await app_client.get(f"{path}/switches"))["items"] == []
    unchanged = await app_client.patch(
        path, json={"expected_revision": 2, "model_version_id": source}
    )
    assert data_of(unchanged)["revision"] == 2


@pytest.mark.parametrize(
    "is_different_task", [False, True], ids=["rule-signature", "task"]
)
async def test_patch_only_accepts_a_confirmed_compatible_target(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    is_different_task: bool,
) -> None:
    instance, trained = await seed_versions(app_client, db_session)
    rules = await seed_rule_versions(db_session, instance)
    source = trained[0] if is_different_task else rules[0]
    original = await deployed(app_client, source)
    path = f"{DEPLOYMENTS}/{original['id']}"
    body = {
        "expected_revision": 1,
        "model_version_id": rules[1],
        "name": "联合变更",
    }
    rejected = await app_client.patch(path, json=body)
    assert rejected.status_code == 409
    assert rejected.json()["code"] == (41434 if is_different_task else 41435)
    current = data_of(await app_client.get(path))
    assert (
        current["revision"],
        current["model_version_id"],
        current["name"],
    ) == (
        1,
        source,
        original["name"],
    )
    assert data_of(await app_client.get(f"{path}/switches"))["items"] == []
    confirmed = await app_client.patch(
        path, json={**body, "is_signature_change_confirmed": True}
    )
    if is_different_task:
        assert confirmed.status_code == 409
        assert data_of(await app_client.get(f"{path}/switches"))["items"] == []
        return
    assert confirmed.status_code == 200
    history = data_of(await app_client.get(f"{path}/switches"))["items"]
    assert len(history) == 1
    assert history[0]["is_signature_change_confirmed"]
    restored = await app_client.post(
        f"{path}:rollback",
        json={
            "expected_revision": 2,
            "switch_id": history[0]["id"],
            "is_signature_change_confirmed": True,
        },
    )
    assert data_of(restored)["model_version_id"] == source
    assert data_of(restored)["revision"] == 3
