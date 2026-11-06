"""压缩任务的投递时机。

⚠ 守一条底线：任务只在请求事务提交之后才进流。先投的话 worker 读到的是提交前
的库，会把新素材当成已删，或把待重压的档当成已压好，而消息已被确认，无人再管。
"""

import datetime as dt
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, cast, get_args

import httpx
import pytest
from fastapi import FastAPI

from lib.db import run_after_commit_hooks
from lib.testing import FakeObjectStore
from platform_server.apps.assets import deps
from platform_server.apps.assets.api import assets, replacement
from platform_server.apps.assets.schemas import AssetOut
from platform_server.deps import get_stream

ASSET_ID = uuid.UUID("0192f0aa-0000-7000-8000-000000000002")
ASSET_URL = f"/api/v1/platform/assets/{ASSET_ID}"
SETTINGS = SimpleNamespace(
    assetcompress_stream="stream",
    assetcompress_group="group",
    app_instance="instance",
)


@dataclass
class Timeline:
    """按发生顺序记下提交与投递。"""

    events: list[str] = field(default_factory=list[str])

    async def publish(self, stream: str, fields: dict[str, str]) -> str:
        del fields
        self.events.append("publish")
        return stream

    async def session(self) -> AsyncIterator[Any]:
        """与 `lib.db.Database.session` 同构：提交之后才跑钩子。"""
        session = SimpleNamespace(info={})
        try:
            yield session
        except Exception:
            self.events.append("rollback")
            raise
        self.events.append("commit")
        await run_after_commit_hooks(cast(Any, session))


def saved_model() -> AssetOut:
    return AssetOut(
        id=ASSET_ID,
        ref=f"asset:{ASSET_ID}",
        kind="model",
        name="pump",
        content_type="model/gltf-binary",
        size_bytes=1,
        checksum="etag",
        created_at=dt.datetime.now(dt.UTC),
        created_by="tester",
        variants=[],
    )


def build_client(timeline: Timeline) -> httpx.AsyncClient:
    """只挂素材路由的应用：会话与流换成记账的替身。"""
    application = FastAPI()
    application.include_router(assets.router)
    application.include_router(replacement.router)
    manage = get_args(assets.ManageDep)[1].dependency
    overrides = application.dependency_overrides
    overrides[manage] = lambda: SimpleNamespace(username="tester")
    overrides[deps.get_session] = timeline.session
    overrides[deps.get_container] = lambda: SimpleNamespace(
        settings=SETTINGS, database=None
    )
    overrides[deps.get_object_store] = FakeObjectStore
    overrides[deps.get_asset_sessions] = lambda: None
    overrides[get_stream] = lambda: timeline
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application),
        base_url="http://test",
    )


async def _saved(*_args: object, **_kwargs: object) -> AssetOut:
    return saved_model()


async def _refused(*_args: object, **_kwargs: object) -> AssetOut:
    raise RuntimeError("事务里出了事")


@pytest.mark.parametrize(
    ("service", "url", "body"),
    [
        ("finalize_upload", f"{ASSET_URL}:finalize", {"name": "pump"}),
        ("request_recompression", f"{ASSET_URL}:recompress", None),
    ],
)
async def test_a_job_is_published_only_after_the_commit(
    monkeypatch: pytest.MonkeyPatch,
    service: str,
    url: str,
    body: dict[str, str] | None,
) -> None:
    timeline = Timeline()
    monkeypatch.setattr(assets, service, _saved)

    async with build_client(timeline) as client:
        response = await client.post(url, json=body)

    assert response.status_code == 200
    assert timeline.events == ["commit", "publish"]


async def test_a_rolled_back_transaction_publishes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    timeline = Timeline()
    monkeypatch.setattr(assets, "finalize_upload", _refused)

    async with build_client(timeline) as client:
        with pytest.raises(RuntimeError):
            await client.post(f"{ASSET_URL}:finalize", json={"name": "pump"})

    assert timeline.events == ["rollback"]


async def test_a_replacement_is_published_after_its_own_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    timeline = Timeline()
    monkeypatch.setattr(replacement, "replace_content", _saved)

    async with build_client(timeline) as client:
        response = await client.post(
            f"{ASSET_URL}:replace",
            json={
                "upload_id": str(uuid.uuid4()),
                "expected_checksum": "etag",
            },
        )

    assert response.status_code == 200
    assert timeline.events == ["publish"]
