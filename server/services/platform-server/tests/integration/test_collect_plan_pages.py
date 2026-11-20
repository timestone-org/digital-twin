"""在 PostgreSQL 上通过内部接口验证采集计划的点位读取边界。"""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

import pytest
from conftest import AppContext
from sqlalchemy import event
from sqlalchemy.engine import ExecutionContext
from sqlalchemy.ext.asyncio import AsyncSession

from integration.collect_helpers import (
    PLAN,
    create_points,
    create_source,
    payload,
    point_item,
)
from integration.test_collect_plan_internal_api import service_headers
from platform_server.apps.collect.crud import point as point_module

pytestmark = pytest.mark.requires_postgres

PAGE_ROWS = 2
CODES = ("p_a", "p_b", "p_c", "p_d", "p_e")


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


async def test_plan_reads_only_required_columns_in_bounded_batches(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        point_module, "PLAN_PAGE_ROWS", PAGE_ROWS, raising=False
    )
    client = app_context.client
    source = await create_source(client)
    await create_points(client, source["id"], *map(point_item, reversed(CODES)))

    with observe_point_reads(app_context.session) as reads:
        response = await client.get(PLAN, headers=service_headers())

    assert response.status_code == 200
    planned = next(
        item
        for item in payload(response)["sources"]
        if item["source_id"] == source["id"]
    )
    assert [point["point_code"] for point in planned["points"]] == list(CODES)
    assert len(reads) == 1
    read = reads[0]
    assert read.is_streaming
    assert read.batch_size == PAGE_ROWS
    assert "description" not in read.projection
    assert "created_at" not in read.projection
