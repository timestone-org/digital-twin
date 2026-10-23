"""模型展示元数据可改名，版本计算内容及部署身份保持不变。"""

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.modeling_helpers import data_of
from integration.test_modeling_open_api import DEPLOYMENTS, _served

pytestmark = pytest.mark.requires_postgres
VERSIONS = "/api/v1/platform/modeling-model-versions"


async def test_rename_changes_metadata_without_replacing_version_or_service(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    deployment, _key = await _served(
        app_client, db_session, worker_sessions, "metadata-model"
    )
    version_id = deployment["model_version_id"]
    original = data_of(await app_client.get(f"{VERSIONS}/{version_id}"))
    renamed = await app_client.patch(
        f"{VERSIONS}/{version_id}",
        json={"name": "每日能耗预测模型", "description": "按日预测能耗"},
    )
    assert renamed.status_code == 200, renamed.text
    answer = data_of(renamed)
    assert answer["name"] == "每日能耗预测模型"
    assert answer["description"] == "按日预测能耗"
    for key, value in original.items():
        if key not in {"name", "description"}:
            assert answer[key] == value
    deployed = data_of(
        await app_client.get(f"{DEPLOYMENTS}/{deployment['id']}")
    )
    assert deployed["model_name"] == answer["name"]
    assert deployed["model_version_id"] == version_id
    assert deployed["code"] == deployment["code"]
    cleared = await app_client.patch(
        f"{VERSIONS}/{version_id}", json={"description": None}
    )
    assert cleared.status_code == 200, cleared.text
    assert data_of(cleared)["description"] is None
    immutable = await app_client.patch(
        f"{VERSIONS}/{version_id}", json={"target_key": "another"}
    )
    assert immutable.status_code == 400
