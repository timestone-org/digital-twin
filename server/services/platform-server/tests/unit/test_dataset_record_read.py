"""窗口扫描的截断口径：留最新那批，触顶靠多查一行而不是靠猜。

⚠ 猜法（`len(rows) == limit`）会把一次恰好取满的完整查询误报成截断，用户于是
被劝去缩小一个根本不需要缩的时间范围（docs/DATASET_DESIGN.md §6.2）。
"""

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from lib.errors.base import ValidationFailed
from platform_server.apps.dataset.crud import RecordWindow
from platform_server.apps.dataset.models import DatasetRecord
from platform_server.apps.dataset.services import record_read

TABLE_ID = uuid.uuid4()


class StubCrud:
    """按固定行数应答的取数替身。"""

    def __init__(self, total: int) -> None:
        """库里一共有这么多行。

        Args: total。
        """
        self.total = total
        self.asked = 0

    async def scan_newest(
        self, session: Any, *, window: RecordWindow, limit: int
    ) -> list[DatasetRecord]:
        """按 `limit + 1` 的口径回行。

        Args: session（用不上，但签名要与真件一致）, window, limit。
        """
        assert session is None
        self.asked = limit
        count = min(self.total, limit + 1)
        return [
            DatasetRecord(
                table_id=window.table_id,
                ts=datetime(2026, 8, 23, hour, tzinfo=UTC),
                row_id=uuid.uuid4(),
                values_json={},
                source="manual",
            )
            for hour in range(count)
        ]


@pytest.fixture
def window() -> RecordWindow:
    """一个只按台账收窄的扫描边界。"""
    return RecordWindow(table_id=TABLE_ID)


async def test_exactly_the_limit_is_complete_not_truncated(
    window: RecordWindow, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = StubCrud(total=3)
    monkeypatch.setattr(record_read, "record_crud", stub)

    scan = await record_read.scan_window(None, window=window, limit=3)

    assert len(scan.rows) == 3
    assert scan.is_truncated is False


async def test_one_row_past_the_limit_is_a_truncation(
    window: RecordWindow, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = StubCrud(total=4)
    monkeypatch.setattr(record_read, "record_crud", stub)

    scan = await record_read.scan_window(None, window=window, limit=3)

    assert len(scan.rows) == 3
    assert scan.is_truncated is True


async def test_the_rows_that_survive_a_truncation_are_the_newest(
    window: RecordWindow, monkeypatch: pytest.MonkeyPatch
) -> None:
    # ⚠ 反扫是截断口径的一部分而不是实现细节：两个同形接口若一个给最新、
    # 一个给最早，合进同一个趋势页共用渲染时就会画出两种曲线
    stub = StubCrud(total=10)
    monkeypatch.setattr(record_read, "record_crud", stub)

    scan = await record_read.scan_window(None, window=window, limit=2)

    assert [row.ts.hour for row in scan.rows] == [0, 1]


def test_a_malformed_moment_is_rejected_instead_of_ignored() -> None:
    # ⚠ 当成没给的话，一个写错格式的时间范围会静默退化成「不限」
    with pytest.raises(ValidationFailed):
        record_read.parse_filters(since="昨天", until=None)


def test_a_missing_moment_means_no_bound() -> None:
    assert record_read.parse_filters(since=None, until=None) == (
        record_read.RecordFilters()
    )


def test_a_naive_moment_is_read_as_utc() -> None:
    filters = record_read.parse_filters(since="2026-08-23T10:00:00", until=None)

    assert filters.since == datetime(2026, 8, 23, 10, tzinfo=UTC)
