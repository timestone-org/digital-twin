"""周期节拍与输入边界。"""

from contextlib import AbstractAsyncContextManager
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.stream import StreamGroup
from platform_server.apps.modeling.schemas.schedule import ModelingScheduleIn
from platform_server.apps.modeling.services.schedule_worker import (
    ModelingScheduler,
    ScheduleWorkerOptions,
    following_occurrence,
)
from unit.source_fakes import InMemoryStream
from unit.wiring_fakes import build_settings


def test_missed_occurrences_preserve_anchor_and_do_not_catch_up() -> None:
    anchor = datetime(2026, 1, 1, tzinfo=UTC)
    assert following_occurrence(
        anchor, anchor + timedelta(days=10, minutes=2), 5
    ) == anchor + timedelta(days=10, minutes=5)
    assert following_occurrence(anchor, anchor, 5) == anchor + timedelta(
        minutes=5
    )


@pytest.mark.parametrize("interval_minutes", [0, 4, 525601])
def test_interval_is_bounded(interval_minutes: int) -> None:
    with pytest.raises(ValidationError):
        ModelingScheduleIn(
            is_enabled=True,
            interval_minutes=interval_minutes,
            expected_revision=0,
        )


def test_first_occurrence_requires_timezone() -> None:
    with pytest.raises(ValidationError):
        ModelingScheduleIn.model_validate(
            {
                "is_enabled": True,
                "expected_revision": 0,
                "first_run_at": "2026-12-01T00:00:00",
            }
        )


class UnusedSessions:
    def session(self) -> AbstractAsyncContextManager[AsyncSession]:
        raise AssertionError("stopped worker must not open a transaction")


async def test_worker_shutdown_drains_after_tick_failure(monkeypatch):
    worker = ModelingScheduler(
        ScheduleWorkerOptions(
            UnusedSessions(),
            InMemoryStream(),
            StreamGroup(stream="test", group="test", consumer="test"),
        )
    )
    visited = []

    async def failed_tick():
        visited.append(True)
        worker.stop()
        raise RuntimeError("tick unavailable")

    monkeypatch.setattr(worker, "tick", failed_tick)
    await worker.run()
    await worker.drain(0.1)
    assert visited == [True]


async def test_worker_configuration_and_drain_timeout():
    settings = build_settings()
    worker = ModelingScheduler.from_settings(
        UnusedSessions(), InMemoryStream(), settings
    )
    assert worker._options.target.stream == settings.modeling_stream
    worker._idle.clear()
    await worker.drain(0)
    worker.stop()
    await worker.tick(datetime.now(UTC))
