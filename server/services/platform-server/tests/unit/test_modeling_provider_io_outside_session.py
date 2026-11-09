"""台账取模型：对象存储的下载与反序列化在数据库会话关掉之后才做。

⚠ 在会话里下载（最大 32 MB）会把一个池连接一直占到下载完，重算一密集就能把池
耗尽，也违反「事务内禁外部 IO」。
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any, cast

import pytest

from lib.objectstore import ObjectStore
from platform_server.apps.dataset.services import Sessions
from platform_server.apps.modeling.operators import CHANNEL_BINARY
from platform_server.apps.modeling.services import model_provider

VERSION_ID = uuid.UUID("01900000-0000-7000-8000-000000000001")


class TrackedSessions:
    """记下会话此刻开着没有。"""

    def __init__(self) -> None:
        self.is_open = False

    @asynccontextmanager
    async def session(self) -> AsyncIterator[object]:
        """Args: 无。"""
        self.is_open = True
        try:
            yield object()
        finally:
            self.is_open = False


async def test_binary_models_are_fetched_after_the_session_closes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sessions = TrackedSessions()
    binding = SimpleNamespace(
        fx_code="模型", is_enabled=True, model_version_id=VERSION_ID
    )
    version = SimpleNamespace(
        id=VERSION_ID,
        servable=True,
        serving_channel=CHANNEL_BINARY,
        serving_json={},
        unservable_reason=None,
    )
    artifact = SimpleNamespace(
        object_key="k", digest="d", format_version=1, runtime_json={}
    )

    async def bindings(*args: Any) -> list[object]:
        del args
        return [binding]

    async def got(*args: Any) -> object:
        del args
        return version

    async def artifact_of(*args: Any) -> object:
        del args
        return artifact

    opened_during_fetch: list[bool] = []

    async def fetch(*args: Any) -> object:
        del args
        opened_during_fetch.append(sessions.is_open)
        return object()

    monkeypatch.setattr(model_provider.binding_crud, "list_by_codes", bindings)
    monkeypatch.setattr(model_provider.model_version_crud, "get", got)
    monkeypatch.setattr(
        model_provider.model_artifact_crud, "get_by_version", artifact_of
    )
    monkeypatch.setattr(model_provider.artifact_io, "fetch", fetch)

    def compiled(serving: object, *, estimator: object) -> str:
        del serving, estimator
        return "compiled"

    monkeypatch.setattr(model_provider, "compile_model", compiled)
    provider = model_provider.ModelingAnalysisProvider(
        store=cast("ObjectStore", object())
    )
    loaded = await provider.load(
        cast("Sessions", sessions), frozenset({"模型"})
    )
    assert loaded == {"模型": "compiled"}
    assert opened_during_fetch == [False]
