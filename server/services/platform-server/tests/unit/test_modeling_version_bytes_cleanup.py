"""模型版本的字节随版本一起走：退役、撞上已有版本、不可服务时都在提交后删掉。

⚠ 不删的话每个退役的二进制模型（最大 32 MB）都永久留在对象存储里，没有任何
路径会再去清理它。
"""

import uuid
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import run_after_commit_hooks
from lib.objectstore import ObjectStore
from platform_server.apps.modeling.services import artifact_store, model_service

VERSION_ID = uuid.UUID("01900000-0000-7000-8000-000000000001")
PROMOTED = "modeling/models/01900000-0000-7000-8000-000000000002/model.pkl"


@dataclass
class RecordingStore:
    """记下被整片删除的前缀。"""

    deleted: list[str] = field(default_factory=list[str])

    async def delete_prefix(self, prefix: str) -> None:
        """Args: prefix。"""
        self.deleted.append(prefix)


def _session() -> AsyncSession:
    """只够登记提交后钩子的假会话。"""
    return cast("AsyncSession", SimpleNamespace(info={}))


def _store(store: RecordingStore) -> ObjectStore:
    """Args: store。"""
    return cast("ObjectStore", store)


async def test_retiring_a_version_drops_its_bytes_after_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def retired(session: AsyncSession, version_id: uuid.UUID) -> None:
        del session, version_id

    monkeypatch.setattr(model_service, "retire_version", retired)
    store = RecordingStore()
    session = _session()
    await model_service.retire_version_command(
        session, VERSION_ID, _store(store)
    )
    assert store.deleted == []
    await run_after_commit_hooks(session)
    assert store.deleted == [artifact_store.model_key(str(VERSION_ID))]


async def test_a_publish_that_hits_an_existing_version_drops_its_copy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def anything(*args: Any, **kwargs: Any) -> Any:
        del args, kwargs
        return SimpleNamespace(id=VERSION_ID)

    for name in ("next_version", "get_by_run"):
        monkeypatch.setattr(model_service.model_version_crud, name, anything)
    monkeypatch.setattr(model_service, "require_active_instance", anything)
    monkeypatch.setattr(model_service, "get_version", anything)
    prepared = model_service.PreparedVersion(
        draft=cast(
            "Any", SimpleNamespace(run=SimpleNamespace(pipeline_id=1, id=2))
        ),
        artifact={"object_key": PROMOTED},
    )
    store = RecordingStore()
    session = _session()
    await model_service.save_prepared_version(
        session, prepared, is_reusing_existing=True, store=_store(store)
    )
    await run_after_commit_hooks(session)
    assert store.deleted == [PROMOTED]
