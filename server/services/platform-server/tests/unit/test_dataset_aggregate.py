"""八档聚合口径：SQL 长什么样，以及桶外那一档 `delta` 怎么接力。

⚠ 这一组守的全是**不报错的错**：`timezone =>` 掉了只是把整天的数记到隔壁那一天；
`delta` 拿本桶 first 顶替只是无声退化回旧口径；空桶写 0 只是把「算不出来」说成
「就是零」。三样在界面上都与正确结果长得一模一样。
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from platform_server.apps.dataset.protocols import AGG_FUNCS
from platform_server.apps.dataset.services.aggregate import (
    AGGREGATE_SQL,
    NUM_COUNT,
    TEXT_COUNT,
    BucketWindow,
    PointColumn,
    UnknownAggregate,
    aggregate_cells,
    build_bucket_query,
    build_previous_end_query,
    lookback_span,
    required_aggs,
)
from unit.dataset_fakes import PREVIOUS_END_MARKER, FakeHistory

SHANGHAI = "Asia/Shanghai"
SOURCE_ID = uuid.UUID("0192f0c0-0000-7000-8000-00000000abcd")
POINT_CODE = "meter_kwh"
NODE_KEY = f"{SOURCE_ID}:{POINT_CODE}"
HOUR = timedelta(hours=1)
FIRST = datetime(2026, 8, 24, 0, 0, tzinfo=UTC)


def window(count: int = 3) -> BucketWindow:
    """一段连着的整点桶。

    Args: count。
    """
    return BucketWindow(
        starts=tuple(FIRST + HOUR * step for step in range(count)),
        interval=HOUR,
        timezone=SHANGHAI,
    )


def column(agg: str, *, key: str = "用电量") -> PointColumn:
    """一列绑在同一个点位上的汇总列。

    Args: agg, key。
    """
    return PointColumn(
        key=key,
        node_key=NODE_KEY,
        agg=agg,
        source_id=SOURCE_ID,
        point_code=POINT_CODE,
    )


def bucket_row(step: int, **values: Any) -> dict[str, object]:
    """一条分桶结果行。缺省样本数取 1，用例只覆盖它关心的那几列。

    Args: step（第几个桶）, values。
    """
    row: dict[str, object] = {
        "source_id": SOURCE_ID,
        "point_code": POINT_CODE,
        "bucket_start": FIRST + HOUR * step,
        NUM_COUNT: 1,
        TEXT_COUNT: 0,
    }
    row.update(values)
    return row


async def cells_of(
    history: FakeHistory, columns: list[PointColumn], count: int = 3
) -> dict[datetime, dict[str, Any]]:
    """跑一次折算并把 `Cell` 摊平成 `{桶: {列key: 值}}`。

    Args: history, columns, count。
    """
    found = await aggregate_cells(
        history, columns=columns, window=window(count)
    )
    return {
        bucket: {key: cell.value for key, cell in row.items()}
        for bucket, row in found.items()
    }


def test_the_whitelist_carries_all_eight_and_only_those() -> None:
    # ⚠ 台账自己出这一份，与采集读侧那份五档的白名单互不牵连
    assert sorted(AGGREGATE_SQL) == sorted(AGG_FUNCS)


@pytest.mark.parametrize(
    ("agg", "fragment"),
    [
        ("avg", "avg(value_num)"),
        ("min", "min(value_num)"),
        ("max", "max(value_num)"),
        ("sum", "sum(value_num)"),
        ("count", "count(value_num)"),
        ("first", "first(value_num, ts) FILTER (WHERE value_num IS NOT NULL)"),
        ("last", "last(value_num, ts) FILTER (WHERE value_num IS NOT NULL)"),
        # delta 的减数在桶外，SQL 这一侧只出本桶末值
        ("delta", "last(value_num, ts) FILTER (WHERE value_num IS NOT NULL)"),
    ],
)
def test_each_mode_renders_the_expression_it_promises(
    agg: str, fragment: str
) -> None:
    sql, _ = build_bucket_query([column(agg)], aggs=[agg], window=window())
    assert f"{fragment} AS {agg}_value" in sql


def test_the_last_and_first_modes_filter_out_the_empty_readings() -> None:
    # ⚠ timescaledb 的 `last(v, t)` 取的是「时间最大那一行的 v」，那一行是 NULL
    # 就回 NULL——一个末尾恰好写过一条空值的桶会把整格算空，而样本明明都在
    for agg in ("last", "first"):
        assert "FILTER (WHERE value_num IS NOT NULL)" in AGGREGATE_SQL[agg]


def test_the_bucket_query_carries_the_dataset_timezone() -> None:
    # ⚠ 不带 `timezone =>` 时 time_bucket 按 UNIX 纪元对齐，东八区的日桶从当地
    # 08:00 开始；而带错时区就是整批行落进隔壁那一格，两样都不报错
    sql, params = build_bucket_query(
        [column("avg")], aggs=["avg"], window=window()
    )
    assert "timezone => :bucket_timezone" in sql
    assert params["bucket_timezone"] == SHANGHAI
    # ⚠ 绑的是 timedelta 而不是字符串：`CAST($1 AS interval)` 让驱动把这个参数
    # 认成 interval，喂 `'1 hour'` 是当场 DataError——而这一层假件看不出来，
    # 真正拦住它的是集成用例里那次真跑
    assert params["bucket_width"] == HOUR


def test_the_bucket_query_is_bounded_on_both_ends() -> None:
    # 单边开区间会让计划器扫遍全部分块
    sql, params = build_bucket_query(
        [column("avg")], aggs=["avg"], window=window()
    )
    assert "ts >= :range_start AND ts < :range_end" in sql
    assert params["range_start"] == FIRST
    assert params["range_end"] == FIRST + HOUR * 3


def test_the_point_identity_travels_as_bound_parameters() -> None:
    # 点位编码是用户可控输入，拼进 SQL 就是注入面
    sql, params = build_bucket_query(
        [column("avg")], aggs=["avg"], window=window()
    )
    assert POINT_CODE not in sql
    assert params["code_0"] == POINT_CODE
    assert params["source_0"] == str(SOURCE_ID)


def test_an_unknown_aggregate_is_loud() -> None:
    # ⚠ 与「文本点位配数值口径」不同：那是数据缺失，这是配置写坏了
    with pytest.raises(UnknownAggregate):
        required_aggs([column("aggregat")])


@pytest.mark.parametrize(
    ("interval", "expected"),
    [
        (timedelta(seconds=1), timedelta(hours=6)),
        (timedelta(minutes=1), timedelta(hours=6)),
        (timedelta(hours=1), timedelta(days=1)),
        (timedelta(days=1), timedelta(days=2)),
    ],
)
def test_the_lookback_is_clamped_on_both_sides(
    interval: timedelta, expected: timedelta
) -> None:
    # ⚠ 下界不能省：稀疏点位会让计划器沿 6 小时一个 chunk 一路摸到保留期尽头
    assert lookback_span(interval) == expected


def test_the_subtrahend_query_has_a_floor() -> None:
    sql, params = build_previous_end_query([column("delta")], window=window())
    assert "ts >= :lookback_start AND ts < :range_start" in sql
    assert params["lookback_start"] == FIRST - timedelta(days=1)


async def test_the_seven_in_bucket_modes_read_their_own_column() -> None:
    history = FakeHistory(
        buckets=[
            bucket_row(
                0,
                avg_value=2.5,
                min_value=1.0,
                max_value=4.0,
                sum_value=5.0,
                count_value=2,
                first_value=1.0,
                last_value=4.0,
                **{NUM_COUNT: 2},
            )
        ]
    )
    columns = [
        column(agg, key=agg)
        for agg in ("avg", "min", "max", "sum", "count", "first", "last")
    ]
    found = await cells_of(history, columns)
    assert found[FIRST] == {
        "avg": 2.5,
        "min": 1.0,
        "max": 4.0,
        "sum": 5.0,
        "count": 2,
        "first": 1.0,
        "last": 4.0,
    }


async def test_a_bucket_with_no_samples_is_absent_rather_than_zero() -> None:
    # ⚠ 空桶 → 这一格不存在，绝不写 0、绝不结转上一桶（D3）
    history = FakeHistory(buckets=[bucket_row(0, avg_value=2.5)])
    found = await cells_of(history, [column("avg")])
    assert list(found) == [FIRST]


async def test_a_count_of_zero_is_blank_not_zero() -> None:
    # ⚠ `count` 也不例外：桶里一条数值样本都没有不等于「这一小时是零条」
    history = FakeHistory(
        buckets=[bucket_row(0, count_value=0, **{NUM_COUNT: 0})]
    )
    found = await cells_of(history, [column("count")])
    assert found[FIRST]["用电量"] is None


async def test_a_text_point_on_a_numeric_mode_is_blank_and_does_not_raise() -> (
    None
):
    # ⚠ 它跑在 leader 的后台 loop 里：一列配错不该让整张表的采集永久中断
    history = FakeHistory(
        buckets=[bucket_row(0, avg_value=None, **{NUM_COUNT: 0, TEXT_COUNT: 3})]
    )
    found = await cells_of(history, [column("avg")])
    assert found[FIRST]["用电量"] is None


async def test_last_falls_back_to_the_text_reading() -> None:
    # 非数值点位只有 value_text，`last` / `first` 数值取不到就还原文本值
    history = FakeHistory(
        buckets=[
            bucket_row(
                0,
                last_value=None,
                last_text="运行",
                **{NUM_COUNT: 0, TEXT_COUNT: 3},
            )
        ]
    )
    found = await aggregate_cells(
        FakeHistory(buckets=history.buckets),
        columns=[column("last")],
        window=window(),
    )
    cell = found[FIRST]["用电量"]
    assert cell.value == "运行"
    # 样本数跟着实际撑起这一格的那一列走，否则界面会把一个有值的格标成 0 样本
    assert cell.samples == 3


async def test_delta_subtracts_the_previous_bucket_end() -> None:
    history = FakeHistory(
        buckets=[
            bucket_row(0, delta_value=110.0),
            bucket_row(1, delta_value=135.0),
        ],
        previous=[
            {
                "source_id": SOURCE_ID,
                "point_code": POINT_CODE,
                "value_num": 100.0,
            }
        ],
    )
    found = await cells_of(history, [column("delta")])
    assert found[FIRST]["用电量"] == 10.0
    assert found[FIRST + HOUR]["用电量"] == 25.0


async def test_delta_without_a_previous_end_is_blank() -> None:
    # ⚠ 绝不拿本桶的 first 顶替：那是无声退化回「桶内 last − first」的旧口径，
    # 而旧口径系统性少算，界面上与真 delta 长得一模一样
    history = FakeHistory(buckets=[bucket_row(0, delta_value=110.0)])
    found = await cells_of(history, [column("delta")])
    assert found[FIRST]["用电量"] is None


async def test_a_counter_reset_leaves_the_cell_blank_not_zero() -> None:
    # ⚠ 负增量意味着计数器清零 / 换表 / 改量程，这一桶的真实增量**无从得知**。
    # 写 0 是在断言「这一桶没有增量」
    history = FakeHistory(
        buckets=[
            bucket_row(0, delta_value=110.0),
            bucket_row(1, delta_value=5.0),
            bucket_row(2, delta_value=9.0),
        ],
        previous=[
            {
                "source_id": SOURCE_ID,
                "point_code": POINT_CODE,
                "value_num": 100.0,
            }
        ],
    )
    found = await cells_of(history, [column("delta")])
    assert found[FIRST]["用电量"] == 10.0
    assert found[FIRST + HOUR]["用电量"] is None
    # 清零之后接力从新的末值继续，而不是一直空下去
    assert found[FIRST + HOUR * 2]["用电量"] == 4.0


async def test_an_empty_bucket_in_the_middle_does_not_break_the_relay() -> None:
    # 末值一直有效到下次变化为止：中间那个桶没有样本，第三个桶仍拿第一个桶的
    # 末值做减数
    history = FakeHistory(
        buckets=[
            bucket_row(0, delta_value=110.0),
            bucket_row(2, delta_value=150.0),
        ],
        previous=[
            {
                "source_id": SOURCE_ID,
                "point_code": POINT_CODE,
                "value_num": 100.0,
            }
        ],
    )
    found = await cells_of(history, [column("delta")])
    assert FIRST + HOUR not in found
    assert found[FIRST + HOUR * 2]["用电量"] == 40.0


async def test_no_subtrahend_query_runs_when_nothing_asks_for_delta() -> None:
    # 减数查询是一次额外的时序扫描，没有 delta 列时不该发生
    history = FakeHistory(buckets=[bucket_row(0, avg_value=1.0)])
    await cells_of(history, [column("avg")])
    assert all(PREVIOUS_END_MARKER not in sql for sql, _ in history.queries)


async def test_two_modes_on_one_point_share_a_single_scan() -> None:
    # 每档一条 SQL 就是 N 遍时序扫描；一条语句渲染出全部要的档位
    history = FakeHistory(buckets=[bucket_row(0, avg_value=2.5, max_value=4.0)])
    found = await cells_of(
        history, [column("avg", key="均值"), column("max", key="峰值")]
    )
    assert found[FIRST] == {"均值": 2.5, "峰值": 4.0}
    assert len(history.queries) == 1


async def test_a_table_with_no_point_columns_asks_the_archive_nothing() -> None:
    history = FakeHistory()
    assert await aggregate_cells(history, columns=[], window=window()) == {}
    assert history.queries == []
