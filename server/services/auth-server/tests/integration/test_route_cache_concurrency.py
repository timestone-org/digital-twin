"""管理端提交后的规则失效不会被此前开始的读取覆写。"""

import asyncio
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.app import build_app
from auth_server.apps.auth.crud import route_rule_crud, user_crud
from auth_server.apps.auth.models import RouteRule
from auth_server.container import Container
from auth_server.settings import API_PREFIX

pytestmark = [
    pytest.mark.requires_postgres,
    pytest.mark.usefixtures("_database_required"),
]

RULES = f"{API_PREFIX}/route-rules"


async def _admin_headers(container: Container) -> dict[str, str]:
    async with container.database.session() as session:
        user = await user_crud.get_by_login(session, "admin")
        assert user is not None
        token = container.tokens.issue_pair(user.id).access_token
    return {"Authorization": f"Bearer {token}"}


async def _read_priority(container: Container, pattern: str) -> int:
    async with container.database.session() as session:
        views = await container.rules.rules(session)
        return next(
            view.priority for view in views if view.path_pattern == pattern
        )


async def test_rule_edit_invalidates_a_real_pending_postgres_load(
    container: Container, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = build_app(container.settings)
    app.state.container = container
    pattern = f"/api/v1/platform/qa-route-{uuid4().hex}"
    headers = await _admin_headers(container)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://auth-test",
        headers=headers,
        timeout=15,
    ) as client:
        created = await client.post(
            RULES,
            json={
                "path_pattern": pattern,
                "http_method": "GET",
                "priority": 100,
            },
        )
        assert created.status_code == 201
        path = f"{RULES}/{created.json()['data']['id']}"
        try:
            original = route_rule_crud.list_enabled
            read = asyncio.Event()
            release = asyncio.Event()

            async def capture(session: AsyncSession) -> list[RouteRule]:
                rows = await original(session)
                if not read.is_set():
                    read.set()
                    await release.wait()
                return rows

            monkeypatch.setattr(route_rule_crud, "list_enabled", capture)
            older = asyncio.create_task(_read_priority(container, pattern))
            try:
                await asyncio.wait_for(read.wait(), timeout=10)
                updated = await client.patch(path, json={"priority": 120})
                assert updated.status_code == 200
                assert await _read_priority(container, pattern) == 120
            finally:
                release.set()
                assert await asyncio.wait_for(older, timeout=10) == 100
            assert await _read_priority(container, pattern) == 120
        finally:
            removed = await client.delete(path)
            assert removed.status_code == 204
