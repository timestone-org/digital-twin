"""重算按实际调度间隔给同一事件循环中的其他任务让步。"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.crud import RecordWindow
from platform_server.apps.dataset.formula import ColumnFormula, build_plan
from platform_server.apps.dataset.models import DatasetRecord
from platform_server.apps.dataset.services import record_compute
from platform_server.apps.dataset.services.record_history import ComputeScope


async def test_recompute_yields_after_a_slow_row_before_the_row_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    times = iter((0.0, 0.0, 0.05, 0.05, 0.05))
    monkeypatch.setattr(
        record_compute, "monotonic", lambda: next(times), raising=False
    )
    monkeypatch.setattr(
        record_compute, "load_whole_stats", AsyncMock(return_value={})
    )
    table_id = uuid.uuid4()
    first = datetime(2026, 1, 1, tzinfo=UTC)
    rows = [
        DatasetRecord(table_id=table_id, ts=first, values_json={"x": 2}),
        DatasetRecord(
            table_id=table_id,
            ts=first + timedelta(minutes=1),
            values_json={"x": 3},
        ),
    ]
    monkeypatch.setattr(
        record_compute.record_crud, "scan_oldest", AsyncMock(return_value=rows)
    )
    plan = build_plan([ColumnFormula("out", "输出", "{x} + 1")], {"x", "out"})
    scope = ComputeScope(plan, {}, UTC)

    async def count_updated_rows() -> int:
        return sum(row.computed_json is not None for row in rows)

    observer = asyncio.create_task(count_updated_rows())
    async with AsyncSession() as session:
        await record_compute.recompute_range(
            session,
            scope,
            table_id=table_id,
            window=RecordWindow(table_id=table_id),
        )
        updated_when_scheduled = await observer
    assert updated_when_scheduled == 1
    assert [row.computed_json for row in rows] == [{"out": 3}, {"out": 4}]


def _stub_seed_history(
    monkeypatch: pytest.MonkeyPatch, target: DatasetRecord
) -> None:
    """准备窗口内两条种子及 PREV 补取的一条。Args: monkeypatch, target。"""
    previous, first, second = [
        DatasetRecord(
            table_id=target.table_id,
            ts=target.ts + timedelta(days=days),
            values_json={"x": value},
        )
        for value, days in enumerate((-400, -2, -1), start=1)
    ]
    monkeypatch.setattr(
        record_compute,
        "load_formula_rows",
        AsyncMock(return_value=[first, second]),
    )
    monkeypatch.setattr(
        record_compute.record_crud,
        "list_before",
        AsyncMock(return_value=[previous]),
    )
    monkeypatch.setattr(
        record_compute.record_crud,
        "scan_oldest",
        AsyncMock(return_value=[target]),
    )
    monkeypatch.setattr(
        record_compute, "load_whole_stats", AsyncMock(return_value={})
    )


async def test_wide_history_yields_while_preserving_the_order_of_seed_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    times = iter((0.0, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05))
    monkeypatch.setattr(
        record_compute, "monotonic", lambda: next(times), raising=False
    )
    moment = datetime(2026, 1, 1, tzinfo=UTC)
    table = uuid.uuid4()
    target = DatasetRecord(table_id=table, ts=moment, values_json={"x": 0})
    _stub_seed_history(monkeypatch, target)
    convert = Mock(wraps=record_compute.to_snapshot)
    monkeypatch.setattr(record_compute, "to_snapshot", convert)
    plan = build_plan(
        [
            ColumnFormula(
                "out", "输出", "SUM_OVER({x}, '1y') + PREV({x}, 3) * 10"
            )
        ],
        {"x", "out"},
    )

    async def count_converted_rows() -> int:
        return convert.call_count

    observer = asyncio.create_task(count_converted_rows())
    async with AsyncSession() as session:
        await record_compute.recompute_range(
            session,
            ComputeScope(plan, {}, UTC),
            table_id=table,
            window=RecordWindow(table_id=table),
        )
        converted_when_scheduled = await observer
    assert converted_when_scheduled == 1
    assert target.computed_json == {"out": 15}
