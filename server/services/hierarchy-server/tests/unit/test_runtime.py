"""层级图配置、探针和容器失败路径。"""

import httpx
import pytest
from pydantic import ValidationError
from starlette.requests import Request

from hierarchy_server.app import build_app, check_dependencies
from hierarchy_server.deps import get_container, service_key
from hierarchy_server.settings import Settings


def test_required_secret_has_no_fallback(settings):
    values = settings.model_dump()
    values.pop("edge_signing_secret")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


async def test_health_never_reads_dependencies(settings, monkeypatch):
    app = build_app(settings)

    async def forbidden():
        raise AssertionError("存活探针不得访问数据库")

    monkeypatch.setattr(app.state.container.database, "ping", forbidden)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/hierarchy/health")).status_code == 200
        assert (await client.get("/api/v1/hierarchy/ready")).status_code == 503
    await app.state.container.database.dispose()
    await app.state.container.cache.close()


async def test_startup_fails_when_storage_is_unavailable(settings, monkeypatch):
    app = build_app(settings)

    async def unavailable():
        return False

    monkeypatch.setattr(app.state.container.database, "ping", unavailable)
    with pytest.raises(RuntimeError, match="未就绪"):
        await check_dependencies(app.state.container)
    await app.state.container.database.dispose()
    await app.state.container.cache.close()


async def test_container_guard_and_internal_secret(settings):
    app = build_app(settings)
    request = Request({"type": "http", "app": app})
    assert service_key(request) == "k" * 32
    await app.state.container.database.dispose()
    await app.state.container.cache.close()
    app.state.container = None
    with pytest.raises(RuntimeError, match="未装配"):
        get_container(request)
