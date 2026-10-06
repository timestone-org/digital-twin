"""平台来源保留请求中的签名身份，由上游独立执行授权。"""

from collections.abc import Callable
from dataclasses import replace
from typing import Annotated

import httpx
import pytest
from fastapi import Depends, FastAPI, Request
from integration.conftest import DbStack, _NoStore

from knowledge_server.app import build_app
from knowledge_server.deps import request_sources
from knowledge_server.settings import Settings
from lib.auth import CallerContext
from lib.errors import AppError
from lib.errors.handlers import register_exception_handlers
from lib.web.authdeps import build_auth_deps

PATH = "/api/v1/platform/dataset-tables"


def _platform(settings: Settings) -> FastAPI:
    application = FastAPI()
    register_exception_handlers(application)
    auth = build_auth_deps(
        signing_secret_of=lambda _request: (
            settings.edge_signing_secret.get_secret_value()
        ),
        service_key_of=lambda _request: (
            settings.edge_service_key.get_secret_value()
        ),
    )

    @application.get(PATH)
    async def read(
        _caller: Annotated[
            CallerContext, Depends(auth.require("dataset:view"))
        ],
    ) -> dict[str, object]:
        return {"code": 0, "data": {"items": [{"row_id": "table-1"}]}}

    return application


async def test_request_source_can_read_with_signed_user_identity(
    settings: Settings, sign: Callable[..., dict[str, str]]
) -> None:
    application = build_app(settings)
    signed = sign(codes=("knowledge:write", "dataset:view"), role="操作员")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=_platform(settings)),
        base_url="http://platform-test",
    ) as platform:
        application.state.container = replace(
            application.state.container, platform=platform
        )
        request = Request(
            {
                "type": "http",
                "app": application,
                "headers": [
                    (name.lower(), value)
                    for name, value in httpx.Headers(signed).raw
                ],
            }
        )
        sources = request_sources(request)
        source = next(one for one in sources if one.kind == "platform")
        page = await source.discover({"path": PATH}, None)
    assert [item.external_ref for item in page.items] == ["table-1"]


async def test_platform_denial_is_a_safe_domain_error(
    settings: Settings, sign: Callable[..., dict[str, str]]
) -> None:
    application = build_app(settings)
    signed = sign(codes=("knowledge:write",))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=_platform(settings)),
        base_url="http://platform-test",
    ) as platform:
        application.state.container = replace(
            application.state.container, platform=platform
        )
        request = Request(
            {
                "type": "http",
                "app": application,
                "headers": [
                    (name.lower(), value)
                    for name, value in httpx.Headers(signed).raw
                ],
            }
        )
        source = next(
            one for one in request_sources(request) if one.kind == "platform"
        )
        with pytest.raises(AppError) as caught:
            await source.discover({"path": PATH}, None)
    assert caught.value.http_status == 403
    assert PATH not in str(caught.value)


class _SyncStore(_NoStore):
    async def put_bytes(
        self, key: str, content: bytes, *, content_type: str
    ) -> None:
        del content_type
        self.objects[key] = content


async def _source_id(client: httpx.AsyncClient) -> str:
    made = await client.post(
        "/api/v1/knowledge/knowledge-bases", json={"name": "平台来源签名测试"}
    )
    assert made.status_code == 201
    base_id = made.json()["data"]["id"]
    source = await client.post(
        f"/api/v1/knowledge/knowledge-bases/{base_id}/sources",
        json={"kind": "platform", "name": "目录", "config": {"path": PATH}},
    )
    assert source.status_code == 201
    return source.json()["data"]["id"]


@pytest.mark.requires_postgres
async def test_sync_registers_platform_documents_with_user_identity(
    db_stack: DbStack, settings: Settings, sign: Callable[..., dict[str, str]]
) -> None:
    db_stack.client.headers.update(
        sign(
            codes=(
                "knowledge:use",
                "knowledge:write",
                "knowledge:manage",
                "dataset:view",
            )
        )
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=_platform(settings)),
        base_url="http://platform-test",
    ) as platform:
        db_stack.app.state.container = replace(
            db_stack.app.state.container,
            platform=platform,
            objectstore=_SyncStore(),
        )
        source_id = await _source_id(db_stack.client)
        path = f"/api/v1/knowledge/sources/{source_id}:sync"
        synced = await db_stack.client.post(path)
        assert synced.status_code == 200
        assert synced.json()["data"] == {
            "registered": 1,
            "skipped": 0,
            "has_more": False,
        }
        repeated = await db_stack.client.post(path)
        assert repeated.status_code == 200
        assert repeated.json()["data"]["registered"] == 0
        assert repeated.json()["data"]["skipped"] == 1


@pytest.mark.requires_postgres
async def test_sync_refuses_platform_data_without_business_permission(
    db_stack: DbStack, settings: Settings
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=_platform(settings)),
        base_url="http://platform-test",
    ) as platform:
        db_stack.app.state.container = replace(
            db_stack.app.state.container, platform=platform
        )
        source_id = await _source_id(db_stack.client)
        response = await db_stack.client.post(
            f"/api/v1/knowledge/sources/{source_id}:sync"
        )
    assert response.status_code == 403
    assert response.json()["code"] == 42314
    assert "dataset-tables" not in response.text
