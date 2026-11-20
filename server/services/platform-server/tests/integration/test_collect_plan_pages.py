"""在 PostgreSQL 上通过内部接口验证采集计划的点位读取边界。"""

from __future__ import annotations

import sys
from asyncio import Event
from contextlib import aclosing, contextmanager
from dataclasses import dataclass
from inspect import unwrap
from typing import TYPE_CHECKING, Final
from uuid import UUID
from weakref import WeakValueDictionary

import pytest
from asyncpg import Record
from asyncpg.cursor import Cursor
from sqlalchemy import event

from integration.collect_helpers import (
    PLAN,
    create_points,
    create_source,
    payload,
    point_item,
)
from integration.test_collect_plan_internal_api import service_headers
from platform_server.apps.collect.crud import point as point_module
from platform_server.apps.collect.protocols import UnknownLiteral
from platform_server.apps.collect.services import CredentialCipher, plan_service

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Iterator
    from types import CodeType
    from typing import Self

    from conftest import AppContext
    from sqlalchemy.engine import ExecutionContext
    from sqlalchemy.ext.asyncio import AsyncSession

    from platform_server.settings import Settings

pytestmark = pytest.mark.requires_postgres

PAGE_ROWS: Final[int] = 2
CODES: Final[tuple[str, ...]] = ("p_a", "p_b", "p_c", "p_d", "p_e")


@dataclass(frozen=True)
class PointRead:
    """点位查询实际使用的列、游标模式与批大小。"""

    projection: str
    is_streaming: bool
    batch_size: object


@contextmanager
def observe_point_reads(session: AsyncSession) -> Iterator[list[PointRead]]:
    """捕获本连接的点位 SELECT 及驱动执行选项。Args: session。"""
    reads: list[PointRead] = []
    engine = session.sync_session.get_bind()

    def record(
        *, statement: str, context: ExecutionContext, **_: object
    ) -> None:
        if (
            statement.lstrip().startswith("SELECT")
            and "collect_points" in statement
        ):
            options = context.execution_options
            reads.append(
                PointRead(
                    statement.partition("FROM")[0],
                    bool(options.get("stream_results")),
                    options.get("yield_per"),
                )
            )

    event.listen(engine, "before_cursor_execute", record, named=True)
    try:
        yield reads
    finally:
        event.remove(engine, "before_cursor_execute", record)


def observe_live_rows(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """记录响应组装时仍存活的点位投影数。Args: monkeypatch。"""
    counts: list[int] = []
    live: WeakValueDictionary[int, point_module.PlanPointRow] = (
        WeakValueDictionary()
    )

    class ObservedRow(point_module.PlanPointRow):
        def __new__(cls, *_args: object, **_kwargs: object) -> Self:
            row = super().__new__(cls)
            live[id(row)] = row
            counts.append(len(live))
            return row

    monkeypatch.setattr(point_module, "PlanPointRow", ObservedRow)
    return counts


async def test_plan_reads_only_required_columns_in_bounded_batches(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        point_module, "PLAN_PAGE_ROWS", PAGE_ROWS, raising=False
    )
    client = app_context.client
    source = await create_source(client)
    await create_points(client, source["id"], *map(point_item, reversed(CODES)))

    counts = observe_live_rows(monkeypatch)
    with observe_point_reads(app_context.session) as reads:
        response = await client.get(PLAN, headers=service_headers())

    assert response.status_code == 200
    planned = next(
        item
        for item in payload(response)["sources"]
        if item["source_id"] == source["id"]
    )
    assert [point["point_code"] for point in planned["points"]] == list(CODES)
    assert max(counts, default=0) <= PAGE_ROWS
    assert len(reads) == 1
    read = reads[0]
    assert read.is_streaming
    assert read.batch_size == PAGE_ROWS
    assert "description" not in read.projection
    assert "created_at" not in read.projection


@contextmanager
def observe_batches() -> Iterator[list[tuple[str, ...]]]:
    """只观察 asyncpg 游标实际返回的点位批次。"""
    batches: list[tuple[str, ...]] = []
    code = unwrap(Cursor.fetch).__code__
    monitor = sys.monitoring
    # Python 3.12 的监控槽为 0–5，避开覆盖率和调试器已占用的槽。
    tool = next(slot for slot in range(6) if monitor.get_tool(slot) is None)
    on_return = monitor.events.PY_RETURN

    def record(_code: CodeType, _offset: int, result: object) -> None:
        if isinstance(result, list) and result:
            codes = tuple(
                str(row["code"])
                for row in result
                if isinstance(row, Record)
                and "source_id" in row
                and "address" in row
            )
            if codes:
                batches.append(codes)

    monitor.use_tool_id(tool, "collect-plan-test")
    try:
        monitor.register_callback(tool, on_return, record)
        monitor.set_local_events(tool, code, on_return)
        yield batches
    finally:
        monitor.set_local_events(tool, code, 0)
        monitor.register_callback(tool, on_return, None)
        monitor.free_tool_id(tool)


async def test_only_enabled_source_points_cross_the_database_cursor(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    batch_size = 64
    monkeypatch.setattr(point_module, "PLAN_PAGE_ROWS", batch_size)
    client = app_context.client
    enabled = await create_source(client)
    empty = await create_source(client, code="empty")
    disabled = await create_source(client, code="stopped", is_enabled=False)
    expected = [f"p_{index:03}" for index in range(2 * batch_size + 5)]
    await create_points(
        client, enabled["id"], *map(point_item, reversed(expected))
    )
    await create_points(client, disabled["id"], point_item("disabled_point"))

    with observe_batches() as batches:
        response = await client.get(PLAN, headers=service_headers())

    assert response.status_code == 200
    sources = payload(response)["sources"]
    assert [item["code"] for item in sources] == [
        empty["code"],
        enabled["code"],
    ]
    assert sources[0]["points"] == []
    assert [code for batch in batches for code in batch] == expected
    assert len(batches) >= 3
    assert all(len(batch) <= batch_size for batch in batches)


async def test_reading_one_plan_point_consumes_only_the_first_fetch_batch(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    batch_size = 64
    monkeypatch.setattr(point_module, "PLAN_PAGE_ROWS", batch_size)
    client = app_context.client
    source = await create_source(client)
    codes = [f"p_{index:03}" for index in range(2 * batch_size + 5)]
    await create_points(client, source["id"], *map(point_item, codes))
    rows = point_module.point_crud.iter_for_plan(
        app_context.session, source_ids=[UUID(source["id"])]
    )
    with observe_batches() as batches:
        async with aclosing(rows):
            first = await anext(rows)
            assert first.code == codes[0]
            assert 0 < sum(map(len, batches)) <= batch_size


async def test_empty_enabled_set_does_not_query_points(
    app_context: AppContext,
) -> None:
    client = app_context.client
    source = await create_source(client, is_enabled=False)
    await create_points(client, source["id"], point_item("offline_point"))
    with observe_point_reads(app_context.session) as reads:
        response = await client.get(PLAN, headers=service_headers())
    assert response.status_code == 200
    assert payload(response)["sources"] == []
    assert reads == []


async def test_conversion_failure_closes_point_iterator(
    app_context: AppContext, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = await create_source(app_context.client)
    closed = Event()

    async def invalid_rows() -> AsyncGenerator[point_module.PlanPointRow, None]:
        try:
            yield point_module.PlanPointRow(
                source_id=UUID(source["id"]),
                code="invalid_type",
                address="ns=2;i=1",
                data_type="unknown",
                sampling_interval_ms=1000,
                deadband=0.0,
                archive_enabled=False,
                archive_max_interval_ms=60000,
            )
        finally:
            closed.set()

    stream = invalid_rows()
    monkeypatch.setattr(
        point_module.point_crud, "iter_for_plan", lambda *_, **__: stream
    )
    cipher = CredentialCipher(
        settings.collect_credential_secret.get_secret_value()
    )
    with pytest.raises(UnknownLiteral, match="未知数据类型"):
        await plan_service.build_plan(app_context.session, cipher=cipher)
    assert closed.is_set()
