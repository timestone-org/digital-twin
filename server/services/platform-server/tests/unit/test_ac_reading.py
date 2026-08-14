"""取数面的纯逻辑：区间校验、桶档位、游标、指标白名单与列形状校验。

⚠ 这几条写错都不会报错：区间不带时区会让同一个请求在不同机器上取到不同数据，
桶档位挑错只是图变疏或变密，游标解析漏一条路径就是一个 500。
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest

from lib.web import decode_cursor, encode_cursor
from platform_server.apps.hvac.datasets import (
    DATASET_RAW_MINUTE,
    DATASETS,
    SOURCE_TIME_COLUMN,
    find_dataset,
    metric_keys,
)
from platform_server.apps.hvac.errors import (
    CursorInvalid,
    MetricUnknown,
    SourceObjectInvalid,
    SourceObjectShapeMismatch,
    TimeRangeInvalid,
)
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services.ac_data_service import (
    ensure_source_object_matches,
)
from platform_server.apps.hvac.services.ac_reading_service import (
    MAX_SAMPLES_SPAN,
    anchor_of,
    caption_for,
    choose_bucket_minutes,
    ensure_window,
    to_cursor_page,
    to_sample,
    validated_metrics,
)
from platform_server.apps.hvac.services.ac_source_reader import SourceRow

START = datetime(2026, 8, 12, 0, 0, tzinfo=UTC)
DAY = timedelta(days=1)
# 取数永远按目录里的全部指标列取，用例也照这个口径走
ALL_COLUMNS = metric_keys(find_dataset(DATASET_RAW_MINUTE) or DATASETS[0])


@dataclass
class StubDescriber:
    """只回答「这个对象有哪些列」的假件，并记下被问过的名字。"""

    columns: dict[str, str]
    asked: list[str] = field(default_factory=list)

    async def describe(self, source_object: str) -> dict[str, str]:
        self.asked.append(source_object)
        return self.columns


def window(hours: float) -> TimeWindow:
    """一个从固定起点开始的区间。

    Args: hours。
    """
    return TimeWindow(start=START, end=START + timedelta(hours=hours))


def full_columns() -> dict[str, str]:
    """形状齐备的一个对象的列表。"""
    dataset = find_dataset(DATASET_RAW_MINUTE)
    assert dataset is not None
    columns = {SOURCE_TIME_COLUMN: "datetime"}
    columns.update(dict.fromkeys(metric_keys(dataset), "float"))
    return columns


def assert_window_accepted(hours: float, *, max_span: timedelta) -> None:
    """区间被接受的契约就是「不抛」。

    Args: hours, max_span。
    """
    ensure_window(window(hours), max_span=max_span)


def test_a_well_formed_window_passes() -> None:
    assert_window_accepted(24, max_span=MAX_SAMPLES_SPAN)


def test_a_naive_bound_is_rejected() -> None:
    # ⚠ 不带时区就只能靠猜，而猜错的表现是数据整体平移且两边都不报错
    # ⚠ 这条用例要的就是 naive 入参，它是被拒的那个东西
    naive = TimeWindow(
        start=datetime.fromisoformat("2026-08-12T00:00:00"),
        end=datetime.fromisoformat("2026-08-13T00:00:00"),
    )
    with pytest.raises(TimeRangeInvalid):
        ensure_window(naive, max_span=MAX_SAMPLES_SPAN)


def test_an_inverted_window_is_rejected() -> None:
    inverted = TimeWindow(start=START + DAY, end=START)
    with pytest.raises(TimeRangeInvalid):
        ensure_window(inverted, max_span=MAX_SAMPLES_SPAN)


def test_an_empty_window_is_rejected() -> None:
    with pytest.raises(TimeRangeInvalid):
        ensure_window(TimeWindow(start=START, end=START), max_span=DAY)


def test_a_window_exactly_at_the_cap_is_accepted() -> None:
    assert_window_accepted(
        MAX_SAMPLES_SPAN.total_seconds() / 3600, max_span=MAX_SAMPLES_SPAN
    )


def test_a_window_one_second_over_the_cap_is_rejected() -> None:
    over = TimeWindow(
        start=START, end=START + MAX_SAMPLES_SPAN + timedelta(seconds=1)
    )
    with pytest.raises(TimeRangeInvalid):
        ensure_window(over, max_span=MAX_SAMPLES_SPAN)


@pytest.mark.parametrize(
    ("hours", "max_points", "expected"),
    [
        (1, 1000, 1),
        (24, 1000, 5),
        (24, 100, 15),
        (24 * 30, 1000, 60),
        (24 * 366, 1000, 720),
        (24 * 366, 100, 1440),
    ],
    ids=["hour", "day", "coarse-day", "month", "year", "coarse-year"],
)
def test_the_bucket_is_the_first_tier_that_fits_the_point_budget(
    hours: int, max_points: int, expected: int
) -> None:
    assert choose_bucket_minutes(timedelta(hours=hours), max_points) == expected


def test_a_span_beyond_the_largest_tier_falls_back_to_a_day() -> None:
    assert choose_bucket_minutes(timedelta(days=4000), 100) == 1440


def test_metrics_keep_the_requested_order_and_drop_duplicates() -> None:
    assert validated_metrics(
        "fan_frequency, workshop_temp_avg ,fan_frequency"
    ) == ("fan_frequency", "workshop_temp_avg")


def test_an_unknown_metric_is_rejected() -> None:
    with pytest.raises(MetricUnknown):
        validated_metrics("workshop_temp_avg,room_pressure")


def test_an_empty_metric_list_is_rejected() -> None:
    with pytest.raises(MetricUnknown):
        validated_metrics(" , ")


def test_more_than_eight_metrics_is_rejected() -> None:
    dataset = find_dataset(DATASET_RAW_MINUTE)
    assert dataset is not None
    with pytest.raises(MetricUnknown):
        validated_metrics(",".join(metric_keys(dataset)[:9]))


def test_the_first_page_anchors_on_the_window_start() -> None:
    assert anchor_of(None, window(24)) == START


def test_a_cursor_anchors_one_second_past_the_last_row() -> None:
    # ⚠ 加 1 秒：外库时间精度到分钟，加 1 秒即可严格前进且不漏行
    cursor = encode_cursor({"ts": "2026-08-12T03:04:00.000Z"})
    assert anchor_of(cursor, window(24)) == datetime(
        2026, 8, 12, 3, 4, 1, tzinfo=UTC
    )


@pytest.mark.parametrize(
    "cursor",
    [
        "!!!",
        "bm90IGpzb24gYXQgYWxs",
        encode_cursor({"other": "2026-08-12T00:00:00.000Z"}),
        encode_cursor({"ts": "not-a-time"}),
        encode_cursor({"ts": "2026-08-12T00:00:00"}),
    ],
    ids=["not-base64", "not-json", "wrong-field", "not-a-time", "naive"],
)
def test_a_malformed_cursor_is_rejected_not_a_500(cursor: str) -> None:
    with pytest.raises(CursorInvalid):
        anchor_of(cursor, window(24))


def rows(count: int) -> list[SourceRow]:
    """`count` 行相隔一分钟的假数据。

    Args: count。
    """
    return [
        SourceRow(
            ts=START + timedelta(minutes=index),
            values={"workshop_temp_avg": 20.5, "fan_frequency": None},
        )
        for index in range(count)
    ]


def test_a_short_page_reports_no_more_and_carries_no_cursor() -> None:
    page = to_cursor_page(rows(2), limit=5, columns=ALL_COLUMNS)
    assert page.has_more is False
    assert page.next is None
    assert len(page.items) == 2


def test_the_extra_row_only_signals_the_next_page() -> None:
    # 多取一行判 has_more，那一行不进 items
    page = to_cursor_page(rows(3), limit=2, columns=ALL_COLUMNS)
    assert page.has_more is True
    assert len(page.items) == 2
    assert decode_cursor(page.next or "") == {"ts": "2026-08-12T00:01:00.000Z"}


def test_the_cursor_carries_only_a_timestamp_anchor() -> None:
    # ⚠ 这条锁住「外库的时刻无重复」这个前提：一旦厂商开始写重复时间戳，
    # 只有时刻的游标会在翻页处漏掉同一时刻的其余行，而漏行是静默的
    page = to_cursor_page(rows(3), limit=2, columns=ALL_COLUMNS)
    assert set(decode_cursor(page.next or "")) == {"ts"}


def test_an_empty_result_is_an_empty_page() -> None:
    page = to_cursor_page([], limit=5, columns=ALL_COLUMNS)
    assert page.has_more is False
    assert page.next is None
    assert page.items == []


def test_a_null_reading_stays_null_instead_of_becoming_zero() -> None:
    # ⚠ 兄弟项目把 NULL 折成 0，于是数据断档被读成一次停机加一次开机
    sample = to_sample(
        SourceRow(ts=START, values={"fan_frequency": None}), ALL_COLUMNS
    )
    assert sample.fan_frequency is None


def test_a_reading_that_is_present_comes_through_as_a_number() -> None:
    sample = to_sample(
        SourceRow(ts=START, values={"workshop_temp_avg": 23.75}), ALL_COLUMNS
    )
    assert sample.workshop_temp_avg == 23.75


def test_a_column_absent_from_the_row_reads_as_null() -> None:
    sample = to_sample(SourceRow(ts=START, values={}), ALL_COLUMNS)
    assert sample.fan_frequency is None


def test_a_caption_is_matched_by_the_device_suffix() -> None:
    assert caption_for("KTStartData_K01", {"K01": "一车间东"}) == "一车间东"


def test_a_caption_that_cannot_be_matched_is_none() -> None:
    assert caption_for("KTStartData_K09", {"K01": "一车间东"}) is None


async def test_a_shaped_object_passes_the_binding_check() -> None:
    describer = StubDescriber(columns=full_columns())
    dataset = find_dataset(DATASET_RAW_MINUTE)
    assert dataset is not None
    await ensure_source_object_matches(
        describer, source_object="KTStartData_K01", dataset=dataset
    )
    assert describer.asked == ["KTStartData_K01"]


async def test_an_object_the_external_source_lacks_is_rejected() -> None:
    describer = StubDescriber(columns={})
    dataset = find_dataset(DATASET_RAW_MINUTE)
    assert dataset is not None
    with pytest.raises(SourceObjectInvalid):
        await ensure_source_object_matches(
            describer, source_object="KTStartData_K99", dataset=dataset
        )


async def test_an_object_without_the_time_column_is_rejected() -> None:
    # ⚠ 同名前缀下混着几个只有 4 列、没有时间列的非时序视图
    columns = full_columns()
    del columns[SOURCE_TIME_COLUMN]
    dataset = find_dataset(DATASET_RAW_MINUTE)
    assert dataset is not None
    with pytest.raises(SourceObjectShapeMismatch):
        await ensure_source_object_matches(
            StubDescriber(columns=columns),
            source_object="06A699",
            dataset=dataset,
        )


async def test_an_object_missing_one_metric_column_is_rejected() -> None:
    columns = full_columns()
    del columns["fan_frequency"]
    dataset = find_dataset(DATASET_RAW_MINUTE)
    assert dataset is not None
    with pytest.raises(SourceObjectShapeMismatch):
        await ensure_source_object_matches(
            StubDescriber(columns=columns),
            source_object="KTStartData_K01",
            dataset=dataset,
        )
