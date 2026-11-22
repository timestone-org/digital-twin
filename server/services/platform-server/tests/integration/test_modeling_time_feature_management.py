"""版本管理页按实际冻结的时间特征步骤识别历史 UTC 口径。"""

import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_management_helpers import seed_versions
from platform_server.apps.modeling.models import ModelingModelVersion

pytestmark = pytest.mark.requires_postgres
VERSIONS = "/api/v1/platform/modeling-model-versions"


@pytest.mark.parametrize(
    ("steps", "is_legacy"),
    [
        ([{"operator": "time_feature", "fitted": {}}], True),
        ([{"operator": "time_feature"}], True),
        (
            [{"operator": "time_feature", "fitted": {"tz_offset_minutes": 0}}],
            False,
        ),
        (
            [
                {
                    "operator": "time_feature",
                    "fitted": {"tz_offset_minutes": 480},
                }
            ],
            False,
        ),
        (
            [
                {
                    "operator": "time_feature",
                    "fitted": {"tz_offset_minutes": 480},
                },
                {"operator": "time_feature", "fitted": {}},
            ],
            True,
        ),
        ([{"operator": "linear_regression", "fitted": {}}], False),
    ],
)
async def test_management_reports_the_time_basis_of_the_version_it_read(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    steps: list[dict[str, object]],
    is_legacy: bool,
) -> None:
    _, identifiers = await seed_versions(app_client, db_session)
    identity = identifiers[0]
    version = await db_session.get(ModelingModelVersion, uuid.UUID(identity))
    assert version is not None
    version.serving_json = {**version.serving_json, "steps": steps}
    await db_session.commit()
    response = await app_client.get(f"{VERSIONS}/{identity}")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["has_legacy_utc_time_features"] is is_legacy
    await db_session.refresh(version)
    assert version.serving_json["steps"] == steps
