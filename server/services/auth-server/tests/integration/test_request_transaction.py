"""认证管理接口在发送成功响应前提交事务。"""

import uuid

import httpx
import pytest

from auth_server.app import build_app
from auth_server.apps.auth.crud import role_crud, user_crud
from auth_server.container import Container
from auth_server.settings import API_PREFIX, Settings
from lib.testing import deferred_commit_failure

pytestmark = [
    pytest.mark.requires_postgres,
    pytest.mark.usefixtures("_database_required"),
]


async def test_role_creation_reports_a_database_commit_failure(
    container: Container, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = build_app(settings)
    app.state.container = container
    original = container.database.session
    async with original() as db:
        actor = await user_crud.get_by_login(db, "admin")
        assert actor is not None
        token = container.tokens.issue_pair(actor.id).access_token
    name = "commit_" + uuid.uuid4().hex[:12]
    headers = {"Authorization": f"Bearer {token}"}
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=10
    ) as client:
        with monkeypatch.context() as patch:
            patch.setattr(
                container.database, "session", deferred_commit_failure(original)
            )
            rejected = await client.post(
                f"{API_PREFIX}/roles",
                headers=headers,
                json={"name": name, "codes": []},
            )
        async with original() as db:
            assert await role_crud.get_by_name(db, name) is None
        assert rejected.status_code == httpx.codes.INTERNAL_SERVER_ERROR
        assert rejected.json()["trace_id"]
        created = await client.post(
            f"{API_PREFIX}/roles",
            headers=headers,
            json={"name": name, "codes": []},
        )
        assert created.status_code == httpx.codes.CREATED
        async with original() as db:
            row = await role_crud.get_by_name(db, name)
            assert row is not None
            await db.delete(row)
