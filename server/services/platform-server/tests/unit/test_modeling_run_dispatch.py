"""运行编排的收尾：编排异常当场落终态，取消与收尾在行锁上排队。"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, replace
from typing import Any, cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lib.objectstore import ObjectStore, ObjectStoreError
from platform_server.apps.modeling.errors import RunNotCancellable
from platform_server.apps.modeling.models import ModelingRun
from platform_server.apps.modeling.services import run_dispatch, run_service
from platform_server.apps.modeling.services.artifact_store import (
    SealedArtifact,
)
from platform_server.apps.modeling.services.node_task import (
    NodePayload,
    NodeResult,
)
from platform_server.apps.modeling.services.run_dispatch import (
    ORCHESTRATION_REASON,
    RUN_DONE,
    DispatchOptions,
    execute_run,
)
from platform_server.apps.modeling.services.run_executor import (
    RunOutcome,
    Sources,
)
from platform_server.apps.modeling.services.sessions import Sessions
from unit.modeling_fakes import DirectRunner, linear_frame, linear_graph


@dataclass
class RowSession:
    """只认一条运行行的会话假件。"""

    run: ModelingRun
    added: list[object] = field(default_factory=list[object])

    async def get(self, _model: object, _identity: object, **_kw: Any) -> Any:
        return self.run

    def add(self, row: object) -> None:
        self.added.append(row)


@dataclass
class RowSessions:
    """每次都交出同一个会话假件的工厂。"""

    current: object

    @asynccontextmanager
    async def session(self) -> AsyncIterator[object]:
        yield self.current


@dataclass
class RacingSession:
    """不加锁读到另一方提交前的快照，加锁才读到提交后的行。"""

    before: ModelingRun
    after: ModelingRun

    async def get(self, _model: object, _identity: object, **kw: Any) -> Any:
        return self.after if kw.get("with_for_update") else self.before


class ArtifactRunner:
    """让线性回归这一步带出一份封存件，触发落对象存储那条路。"""

    def __init__(self) -> None:
        self._direct = DirectRunner()

    async def run(self, payload: NodePayload) -> NodeResult:
        """就地跑一个算子。Args: payload。"""
        result = await self._direct.run(payload)
        if payload.operator != "linear_regression":
            return result
        return replace(
            result,
            artifact=SealedArtifact(
                payload=b"model", digest="d", format_version=1, runtime={}
            ),
        )


class BrokenStore:
    """写字节一律失败的对象存储。"""

    async def put_bytes(self, *_args: object, **_kwargs: object) -> None:
        raise ObjectStoreError("对象存储操作失败")


def pending_run() -> ModelingRun:
    return ModelingRun(
        id=uuid.uuid4(),
        pipeline_id=uuid.uuid4(),
        status="pending",
        attempt=0,
        graph_snapshot=linear_graph().model_dump(mode="json"),
        is_keeping_frames=False,
        publication_status="pending",
    )


def sessions_of(run: ModelingRun) -> Sessions:
    return cast("Sessions", RowSessions(RowSession(run)))


def with_frames(monkeypatch: pytest.MonkeyPatch) -> None:
    async def load(*_args: object, **_kwargs: object) -> Sources:
        return Sources(frames={"s": linear_frame(50)})

    monkeypatch.setattr(run_dispatch, "_load_sources", load)


def options_of(store: object | None = None) -> DispatchOptions:
    return DispatchOptions(
        runner=ArtifactRunner(),
        tz_offset_minutes=480,
        store=cast("ObjectStore | None", store),
    )


@pytest.mark.parametrize(
    ("store", "reason"),
    [
        (None, "这条流水线产出了二进制模型，而本部署没有配对象存储"),
        (BrokenStore(), "对象存储操作失败"),
    ],
)
async def test_an_artifact_that_cannot_be_written_fails_the_run_at_once(
    monkeypatch: pytest.MonkeyPatch, store: object | None, reason: str
) -> None:
    """产物落不进存储：当场 failed 并带原因，流水线随即解锁。"""
    with_frames(monkeypatch)
    run = pending_run()
    report = await execute_run(
        sessions_of(run), run_id=run.id, options=options_of(store)
    )
    assert (report.outcome, report.status) == (RUN_DONE, "failed")
    assert report.pipeline_id == run.pipeline_id
    assert run.status == "failed"
    assert run.error_text == reason
    assert run.finished_at is not None
    assert run.publication_status == "skipped"


async def test_an_unexpected_source_error_fails_without_leaking_details(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """取数阶段的意外异常也要收尾，内部细节只进日志。"""

    async def explode(*_args: object, **_kwargs: object) -> Sources:
        raise RuntimeError("connection to 10.0.0.1 refused")

    monkeypatch.setattr(run_dispatch, "_load_sources", explode)
    run = pending_run()
    report = await execute_run(
        sessions_of(run), run_id=run.id, options=options_of()
    )
    assert report.status == "failed"
    assert run.status == "failed"
    assert run.error_text == ORCHESTRATION_REASON


async def test_a_cancelled_task_is_not_turned_into_a_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """宽限期到点取消的运行不落终态：消息没确认，要留给重新认领。"""

    async def cancelled(*_args: object, **_kwargs: object) -> Sources:
        raise asyncio.CancelledError

    monkeypatch.setattr(run_dispatch, "_load_sources", cancelled)
    run = pending_run()
    with pytest.raises(asyncio.CancelledError):
        await execute_run(sessions_of(run), run_id=run.id, options=options_of())
    assert run.status == "running"


async def test_cancel_is_rejected_once_the_locked_row_is_terminal() -> None:
    """取消读到 running 的同时 worker 已提交终态：不许把终态改回 cancelling。"""
    before = pending_run()
    before.status = "running"
    after = pending_run()
    after.status = "succeeded"
    with pytest.raises(RunNotCancellable):
        await run_service.cancel_run(
            cast("AsyncSession", RacingSession(before, after)), after.id
        )
    assert (before.status, after.status) == ("running", "succeeded")


async def test_finish_writes_through_the_row_lock() -> None:
    """终态落在加锁读到的行上，与 cancel 的写入串行。"""
    before = pending_run()
    after = pending_run()
    await run_dispatch._finish(  # pyright: ignore[reportPrivateUsage]
        cast("Sessions", RowSessions(RacingSession(before, after))),
        after.id,
        RunOutcome(status="succeeded", nodes=()),
    )
    assert (before.status, after.status) == ("pending", "succeeded")
