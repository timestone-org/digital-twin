"""台账取行对着真库跑：整行扫描分页取、序列只搬点名的列。

⚠ `statement_timeout` 把结果传回客户端的时间也算在内：一行带着三列 JSON 能有
十几 KB，一条语句整搬一天的行，跨网就是好几秒，而库里执行只要几毫秒——现象是
重算与趋势一律「服务暂时不可用」。这一类只有真库上数语句条数才逮得到。
"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import AppContext
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from integration.dataset_helpers import create_table
from lib.utils.ids import uuid7
from platform_server.apps.dataset.crud import (
    CollectedRow,
    RecordWindow,
    record_crud,
)
from platform_server.apps.dataset.crud import record as record_module
from platform_server.apps.dataset.models import DatasetRecord
from platform_server.apps.dataset.services.effective import merge_effective

pytestmark = pytest.mark.requires_postgres

START = datetime(2026, 11, 9, 0, 0, tzinfo=UTC)
# 一页两行：七个时刻 + 同一时刻上的第二行，翻页必然跨过那对同 ts 的行
PAGE_ROWS = 2
MOMENTS = [START + timedelta(minutes=minute) for minute in range(7)]
SHARED_TS = MOMENTS[3]
EPOCH = datetime(2000, 1, 1, tzinfo=UTC)
FOREVER = datetime(2100, 1, 1, tzinfo=UTC)


@contextmanager
def counted_scans(session: AsyncSession) -> Iterator[list[str]]:
    """数这条连接上发出了几条取台账行的 SELECT。

    Args: session。
    """
    issued: list[str] = []
    # 回滚夹具里会话绑的是那一条共用连接；连接与引擎都能挂这个事件
    engine = session.sync_session.get_bind()

    def on_execute(*args: Any) -> None:
        statement = str(args[2])
        if statement.lstrip().startswith("SELECT") and (
            "dataset_records" in statement
        ):
            issued.append(statement)

    event.listen(engine, "before_cursor_execute", on_execute)
    try:
        yield issued
    finally:
        event.remove(engine, "before_cursor_execute", on_execute)


async def seed(
    context: AppContext,
) -> tuple[uuid.UUID, list[tuple[datetime, uuid.UUID]]]:
    """种八行（其中两行同 ts），回台账 id 与全部行键（正序）。

    Args: context。
    """
    table = await create_table(context.client, code=f"scan_{uuid7().hex[:8]}")
    table_id = uuid.UUID(table["id"])
    rows = [
        CollectedRow(
            ts=moment, row_id=uuid7(), values={"读数": 1.0}, samples={}
        )
        for moment in [*MOMENTS, SHARED_TS]
    ]
    await record_crud.upsert_collected(
        context.session, table_id=table_id, rows=rows, manual_keys=[]
    )
    await context.session.commit()
    keys = sorted((row.ts, row.row_id) for row in rows)
    return table_id, keys


@pytest.fixture
def small_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    """把一页压到两行，让八行的扫描必须翻页。"""
    monkeypatch.setattr(
        record_module, "SCAN_PAGE_ROWS", PAGE_ROWS, raising=False
    )


@pytest.mark.usefixtures("small_pages")
async def test_the_oldest_first_scan_pages_without_gaps_or_repeats(
    app_context: AppContext,
) -> None:
    table_id, keys = await seed(app_context)
    window = RecordWindow(table_id=table_id, since=EPOCH, until=FOREVER)

    async with app_context.sessions.session() as session:
        with counted_scans(session) as issued:
            rows = await record_crud.scan_oldest(
                session, window=window, limit=len(keys)
            )

    assert [(row.ts, row.row_id) for row in rows] == keys
    # 八行 + 判触顶多查的一行，按两行一页至少五条语句
    assert len(issued) >= len(keys) // PAGE_ROWS + 1


@pytest.mark.usefixtures("small_pages")
async def test_the_newest_first_scan_keeps_the_newest_batch_when_truncated(
    app_context: AppContext,
) -> None:
    table_id, keys = await seed(app_context)
    window = RecordWindow(table_id=table_id, since=EPOCH, until=FOREVER)
    limit = 4

    async with app_context.sessions.session() as session:
        with counted_scans(session) as issued:
            rows = await record_crud.scan_newest(
                session, window=window, limit=limit
            )

    # 多取的那一行只用来判触顶：回的是最新 limit + 1 行，倒序
    assert [(row.ts, row.row_id) for row in rows] == keys[::-1][: limit + 1]
    assert len(issued) == len(rows) // PAGE_ROWS + 1


@pytest.mark.usefixtures("small_pages")
async def test_paging_respects_the_callers_own_anchor(
    app_context: AppContext,
) -> None:
    # 记录列表自己就是键集翻页：它的锚点与扫描内部的分页锚点不许互相覆盖
    table_id, keys = await seed(app_context)
    anchor = keys[5]
    window = RecordWindow(
        table_id=table_id, since=EPOCH, until=FOREVER, after_key=anchor
    )

    async with app_context.sessions.session() as session:
        rows = await record_crud.scan_newest(
            session, window=window, limit=len(keys)
        )

    assert [(row.ts, row.row_id) for row in rows] == keys[:5][::-1]


async def test_the_picked_scan_keeps_only_the_named_keys_with_presence(
    app_context: AppContext,
) -> None:
    # ⚠ 公式列「算出空也算数」：computed 里的 null 必须原样在场，丢了就会让
    # values 里的旧值借尸还魂；可空列里的 JSON null 也不许让整条语句报错
    table = await create_table(
        app_context.client, code=f"pick_{uuid7().hex[:8]}"
    )
    table_id = uuid.UUID(table["id"])
    app_context.session.add_all(
        [
            DatasetRecord(
                table_id=table_id,
                ts=MOMENTS[0],
                row_id=uuid7(),
                values_json={"读数": 1.0, "旧值": 9.0, "无关": "x" * 64},
                overrides_json={"读数": {"v": 5.0, "by": "u"}},
                computed_json={"旧值": None, "无关算": 1},
                source="manual",
            ),
            DatasetRecord(
                table_id=table_id,
                ts=MOMENTS[1],
                row_id=uuid7(),
                values_json={"无关": 1},
                overrides_json=None,
                computed_json=None,
                source="manual",
            ),
        ]
    )
    await app_context.session.commit()
    window = RecordWindow(table_id=table_id, since=EPOCH, until=FOREVER)

    async with app_context.sessions.session() as session:
        rows = await record_crud.scan_newest_picked(
            session, window=window, keys=["读数", "旧值"], limit=10
        )

    assert [row.ts for row in rows] == [MOMENTS[1], MOMENTS[0]]
    empty, full = rows
    assert (empty.values, empty.overrides, empty.computed) == (None, None, None)
    assert full.values == {"读数": 1.0, "旧值": 9.0}
    assert full.overrides == {"读数": {"v": 5.0, "by": "u"}}
    assert full.computed == {"旧值": None}
    merged = merge_effective(full.values, full.overrides, full.computed)
    assert merged == {"读数": 5.0, "旧值": None}
