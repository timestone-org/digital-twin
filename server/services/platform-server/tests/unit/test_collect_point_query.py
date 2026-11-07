"""点位状态查询的分类、严格运行态读取与超时取消口径。"""

import asyncio
import uuid
from dataclasses import replace
from typing import Never

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from collectwire import FIELD_QUALITY, FIELD_TIMESTAMP_MS, FIELD_VALUE
from lib.errors import DependencyUnavailable
from lib.web import PageParams
from platform_server.apps.collect.errors import HistoryUnavailable
from platform_server.apps.collect.services.point_query import (
    PointFilters,
    PointQueryContext,
    list_points,
    point_status,
)
from platform_server.apps.collect.services.snapshot_source import (
    PointReading,
    decode_reading,
)
from platform_server.apps.collect.services.state_source import (
    UNKNOWN,
    SourceStateSource,
)
from unit.collect_fakes import FakeHistorySource
from unit.publish_fakes import FakeSnapshotSource


@pytest.mark.parametrize("value", [0, False, None, "稳定值"])
def test_old_sample_timestamps_and_falsey_values_are_still_good(
    value: object,
) -> None:
    reading = PointReading(value=value, timestamp_ms=1, quality="good")
    assert point_status(reading, replace(UNKNOWN, state="online")) == "good"


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_a_non_finite_reading_keeps_its_status(literal: str) -> None:
    # 状态只看快照在不在、源在不在线、质量位；读数能不能推是推送线形的事
    raw = (
        f'{{"{FIELD_VALUE}": {literal}, "{FIELD_TIMESTAMP_MS}": 1, '
        f'"{FIELD_QUALITY}": "good"}}'
    )
    status = point_status(decode_reading(raw), replace(UNKNOWN, state="online"))
    assert status == "good"


async def test_strict_runtime_read_preserves_dependency_failures() -> None:
    source = SourceStateSource(
        history=FakeHistorySource(failure=HistoryUnavailable("暂时不可用"))
    )
    with pytest.raises(HistoryUnavailable, match="暂时不可用"):
        await source.read([uuid.UUID(int=1)], is_strict=True)


async def test_query_budget_cancels_pending_database_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    canceled = asyncio.Event()
    blocked = asyncio.Event()

    async def execute(*_arguments: object, **_options: object) -> Never:
        try:
            await blocked.wait()
        finally:
            canceled.set()
        raise AssertionError("测试数据库调用不应完成")

    async with AsyncSession() as session:
        monkeypatch.setattr(session, "execute", execute)
        context = PointQueryContext(
            snapshots=FakeSnapshotSource(),
            states=SourceStateSource(history=FakeHistorySource()),
            timeout_s=0,
        )
        with pytest.raises(DependencyUnavailable, match="查询超时"):
            await list_points(
                session,
                context,
                filters=PointFilters(None, None, "abnormal"),
                page=PageParams(page=1, size=20),
            )
    assert canceled.is_set()
