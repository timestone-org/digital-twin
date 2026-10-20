"""层级图测试数据与隔离 PostgreSQL、Redis 连接。"""

import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from uuid import UUID

import httpx
import pytest
from pydantic import SecretStr

from hierarchy_server.app import build_app
from hierarchy_server.apps.projects.schemas.graph import HierarchyDocument
from hierarchy_server.settings import Settings
from lib.auth import (
    SignedContext,
    encode_identity,
    encode_permissions,
    sign_context,
)
from lib.utils.timeutils import utcnow

OWNER = UUID("10000000-0000-0000-0000-000000000001")


@pytest.fixture
def document() -> HierarchyDocument:
    return HierarchyDocument.model_validate(
        json.loads((Path(__file__).parent / "fixtures/sample.json").read_text())
    )


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        postgres_host=os.getenv("HIERARCHY_POSTGRES_HOST", "127.0.0.1"),
        postgres_port=int(os.getenv("HIERARCHY_POSTGRES_PORT", "55432")),
        postgres_user=os.getenv("HIERARCHY_POSTGRES_USER", "hierarchy_test"),
        postgres_password=SecretStr(
            os.getenv("HIERARCHY_POSTGRES_PASSWORD", "hierarchy-test-only")
        ),
        postgres_db=os.getenv("HIERARCHY_POSTGRES_DB", "hierarchy_test"),
        redis_host=os.getenv("HIERARCHY_REDIS_HOST", "127.0.0.1"),
        redis_port=int(os.getenv("HIERARCHY_REDIS_PORT", "56379")),
        redis_db=14,
        edge_signing_secret=SecretStr("s" * 32),
        edge_service_key=SecretStr("k" * 32),
    )


def headers(
    owner: UUID = OWNER,
    codes: tuple[str, ...] = ("hierarchy:view", "hierarchy:manage"),
) -> dict[str, str]:
    permissions = encode_permissions(codes)
    expires = int(utcnow().timestamp()) + 900
    role = encode_identity("tester")
    context = SignedContext(
        user_id=str(owner),
        role=role,
        permissions_b64=permissions,
        expires_at=expires,
    )
    return {
        "X-Auth-User-Id": str(owner),
        "X-Auth-Username": encode_identity("测试员"),
        "X-Auth-Role": role,
        "X-Auth-Permissions": permissions,
        "X-Auth-Exp": str(expires),
        "X-Auth-Sig": sign_context("s" * 32, context),
    }


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    app = build_app(settings)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://hierarchy-test",
            timeout=10,
        ) as client,
    ):
        client.headers.update(headers())
        yield client
