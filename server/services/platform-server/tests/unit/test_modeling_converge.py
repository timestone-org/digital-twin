"""收敛清字节：没有节点行的半路断掉的运行也要进清理。"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import cast

import pytest

from lib.objectstore import ObjectStore
from platform_server.apps.modeling.services import retention
from platform_server.apps.modeling.services.artifact_store import run_prefix
from platform_server.apps.modeling.services.retention import converge_pipeline
from platform_server.apps.modeling.services.run_dispatch import (
    INTERRUPTED_REASON,
    ORCHESTRATION_REASON,
)
from platform_server.apps.modeling.services.sessions import Sessions


class BareSessions:
    """交出一个不被碰的会话。"""

    @asynccontextmanager
    async def session(self) -> AsyncIterator[object]:
        yield object()


@dataclass
class RecordingStore:
    """记下被整片删除的前缀。"""

    deleted: list[str] = field(default_factory=list[str])

    async def delete_prefix(self, prefix: str) -> None:
        self.deleted.append(prefix)


async def test_a_listed_run_without_node_rows_has_its_bytes_dropped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """名单上的运行一个节点行都没有时，字节照样删。"""
    run_id = uuid.uuid4()
    seen: dict[str, object] = {}

    async def published(*_args: object) -> frozenset[uuid.UUID]:
        return frozenset()

    async def listed(*_args: object, **kwargs: object) -> list[uuid.UUID]:
        seen.update(kwargs)
        return [run_id]

    async def no_rows(*_args: object) -> int:
        return 0

    monkeypatch.setattr(
        retention.model_version_crud, "published_run_ids", published
    )
    monkeypatch.setattr(retention.run_crud, "ids_beyond_keep", listed)
    monkeypatch.setattr(retention.node_run_crud, "delete_by_run", no_rows)
    store = RecordingStore()
    removed = await converge_pipeline(
        cast("Sessions", BareSessions()),
        pipeline_id=uuid.uuid4(),
        keep=1,
        store=cast("ObjectStore", store),
    )
    assert removed == 0
    assert seen["leftover_reasons"] == {
        INTERRUPTED_REASON,
        ORCHESTRATION_REASON,
    }
    assert store.deleted == [run_prefix(str(run_id))]
