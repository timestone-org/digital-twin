"""真实 PostgreSQL 下分别处理部署编码冲突和其他完整性问题。"""

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_management_helpers import seed_versions
from integration.test_modeling_deployment_switches import DEPLOYMENTS
from platform_server.apps.modeling.services.constraints import violates

pytestmark = pytest.mark.requires_postgres


async def test_unrelated_integrity_error_is_not_a_code_conflict(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    await db_session.execute(
        text(
            "ALTER TABLE platform.modeling_deployments "
            "ADD CONSTRAINT qa_deployment_name_check "
            "CHECK (name <> '测试约束拦截')"
        )
    )
    await db_session.commit()
    payload = {
        "name": "测试约束拦截",
        "code": "qa-deployment-check",
        "model_version_id": versions[0],
    }

    with pytest.raises(IntegrityError) as caught:
        await app_client.post(DEPLOYMENTS, json=payload)
    assert violates(caught.value, "qa_deployment_name_check")

    payload["name"] = "修正后的正常部署"
    accepted = await app_client.post(DEPLOYMENTS, json=payload)
    assert accepted.status_code == 201
    assert accepted.json()["data"]["code"] == payload["code"]
