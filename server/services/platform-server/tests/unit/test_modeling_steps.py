"""块的算料：分箱、时间轴占用、按列归因、样例值、漏斗、类型对照。

⚠ 这六样是 24 个算子共用的一份，钉的是**算出来的数**而不是形状：形状对而数错
的块在界面上一样有图有字，只是每个数都不对。
"""

import math

from platform_server.apps.modeling.operators import steps
from platform_server.apps.modeling.operators.steps import Stage

MINUTE_MS = 60_000


def test_a_funnel_keeps_the_level_it_cannot_count_as_none() -> None:
    """数不出来的那一级留 None 并说清为什么，不拿手里的数顶替。"""
    got = steps.funnel_of(
        (Stage("台账列数", None, "列", "没跟着交进来"), Stage("选中", 9, "列"))
    )
    assert got[0] == {
        "name": "台账列数",
        "value": None,
        "unit": "列",
        "note": "没跟着交进来",
    }
    assert got[1]["value"] == 9


def test_a_funnel_hands_every_level_over_for_the_block_to_cut() -> None:
    """漏斗自己不截：截在这里的话，块上记的「一共几级」恒等于上限。

    六级封顶由 `rows_block` 做，它同时把截断前的级数记进 payload。
    """
    stages = tuple(Stage(f"第{index}级", index) for index in range(10))
    assert len(steps.funnel_of(stages)) == 10


def test_the_buckets_are_equal_width_over_the_data() -> None:
    """不给两端时按数据的两端等宽切：1~4 切两桶是各两个。"""
    spread = steps.spread_of([1.0, 2.0, 3.0, 4.0], buckets=2)
    assert (spread.counts, spread.low, spread.high) == ([2.0, 2.0], 1.0, 4.0)


def test_blanks_and_nans_land_off_the_axis_instead_of_in_a_bucket() -> None:
    """空值与 NaN 在数轴上没有位置，单独记成离轴的那一撮。"""
    spread = steps.spread_of([1.0, None, math.nan, math.inf, 2.0], buckets=2)
    assert spread.off_count == 3
    assert sum(spread.counts) == 2


def test_values_outside_a_given_axis_are_clamped_not_counted_as_missing() -> (
    None
):
    """给了两端时端外的值夹进最边上那个桶——算进离轴会与空值混成一个数。"""
    spread = steps.spread_of([-5.0, 100.0], buckets=2, low=0.0, high=10.0)
    assert (spread.counts, spread.off_count) == ([1.0, 1.0], 0)


def test_a_column_with_one_value_gets_a_single_bucket() -> None:
    """全等值只切一个桶：按跨度切会除以零。"""
    spread = steps.spread_of([5.0, 5.0, 5.0], buckets=8)
    assert (spread.counts, spread.low, spread.high) == ([3.0], 5.0, 5.0)


def test_a_column_with_nothing_on_the_axis_keeps_the_axis_it_was_given() -> (
    None
):
    """一个数都没有时不编两端，给什么留什么。"""
    spread = steps.spread_of([None, None], low=0.0, high=1.0)
    assert (spread.counts, spread.low, spread.high, spread.off_count) == (
        [],
        0.0,
        1.0,
        2,
    )


def test_a_bin_column_says_none_when_nothing_fell_off_the_axis() -> None:
    """没有离轴的那一撮就是 None：空壳会让界面画一根 0 根的柱子。"""
    bins = steps.column_bins("温度", steps.spread_of([1.0, 2.0]))
    assert bins.off_axis is None
    assert (bins.low, bins.high) == (1.0, 2.0)


def test_a_bin_column_carries_the_off_axis_count_and_its_label() -> None:
    """离轴的那一撮连名带数一起带出去。"""
    bins = steps.column_bins(
        "温度", steps.spread_of([1.0, None]), off_label="空值"
    )
    assert bins.off_axis == {"label": "空值", "count": 1}


def test_occupancy_is_measured_against_the_median_sampling_step() -> None:
    """占用率按中位采集间隔折算这一格本该有多少行，不按最忙那一格归一。

    ⚠ 按最忙那一格归一的话，同一段数据换个时间范围画出来的高矮就不一样。
    """
    moments = [0, 1000, 2000, 3000, 4000, 50_000]
    span = steps.axis_span(moments, slots=5)
    assert span.step_ms == 1000
    assert span.occupancy == [0.5, 0.0, 0.0, 0.0, 0.1]


def test_a_short_run_is_not_spread_over_more_slots_than_it_has_readings() -> (
    None
):
    """行数比格数少时不许把格子切得比采集间隔还细。

    ⚠ 切细了之后每格「本该有多少行」恒为 1，占用率退化成「行数 ÷ 格数」：这一段
    每 10 秒一行、一个断档都没有，旧算法却会印出「平均占用率 24%」。
    """
    moments = [index * 10_000 for index in range(48)]
    span = steps.axis_span(moments, slots=200)
    assert span.gaps == []
    assert len(span.occupancy) == 47
    assert sum(span.occupancy) / len(span.occupancy) == 1.0


def test_a_slot_still_shows_the_share_it_is_missing() -> None:
    """格子不比间隔细以后，缺行的那一格照旧按缺多少画矮。

    ⚠ 与上一条一起看才有意义：只钉「满格是 1.0」的话，把占用率写死成 1 也能绿。
    """
    moments = [0, 10_000, 20_000, 30_000, 60_000, 70_000, 80_000, 90_000]
    span = steps.axis_span(moments, slots=200, factor=10)
    assert len(span.occupancy) == 9
    assert span.occupancy == [1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0]


def test_a_gap_says_how_many_rows_are_missing_in_it() -> None:
    """断档给出这一段本该有多少行——「断了 46 秒」看不出丢了 45 行。"""
    span = steps.axis_span([0, 1000, 2000, 3000, 4000, 50_000], slots=5)
    assert span.gaps == [{"since": 4000, "until": 50_000, "missing": 45}]


def test_a_run_of_evenly_spaced_rows_has_no_gaps() -> None:
    """按周期上来的数据一个断档都不该报。"""
    span = steps.axis_span([index * MINUTE_MS for index in range(60)])
    assert span.gaps == []
    assert span.step_ms == MINUTE_MS


def test_the_sampling_step_is_the_median_not_the_smallest_gap() -> None:
    """采集间隔取中位数：取最小的那一个间隔，一次抖动就把整条占用率压平。"""
    assert steps.axis_span([0, 1, 1000, 2000, 3000]).step_ms == 1000


def test_a_single_moment_cannot_state_a_sampling_step() -> None:
    """一行、或全挤在同一时刻时算不出间隔——给 None 不给 0。"""
    assert steps.axis_span([7]).step_ms is None
    assert steps.axis_span([7, 7, 7]) == steps.AxisSpan([], [], None)


def test_the_occupancy_series_is_capped_at_two_hundred_slots() -> None:
    """占用率最多两百格：再细的格子在图上一个像素都占不到。"""
    span = steps.axis_span(
        [index * MINUTE_MS for index in range(1000)], slots=5000
    )
    assert len(span.occupancy) == 200


def test_the_longest_gaps_survive_the_cap() -> None:
    """断档超过上限时留最长的那些，不是碰上的头几个。"""
    moments: list[int] = []
    at = 0
    for run in range(30):
        for _ in range(5):
            moments.append(at)
            at += 1000
        at += 100_000 + run * 10_000
    span = steps.axis_span(moments)
    widths = [gap["until"] - gap["since"] for gap in span.gaps]
    assert len(widths) == 20
    assert widths == sorted(widths, reverse=True)


def test_dropped_bins_subtract_what_stayed_from_what_came_in() -> None:
    """逐桶的丢弃段 = 进来的减留下的，两份铺在同一条轴上。"""
    before = steps.spread_of([1.0, 2.0, 3.0, 4.0], buckets=2)
    after = steps.spread_of([3.0, 4.0], buckets=2, low=1.0, high=4.0)
    assert steps.dropped_bins(before, after) == [2.0, 0.0]


def test_dropped_bins_never_report_more_kept_than_came_in() -> None:
    """减出负数一律夹回 0：那说明两条轴对不上，不许把留下的画成丢掉的。"""
    before = steps.spread_of([1.0, 2.0], buckets=2)
    after = steps.spread_of([1.0, 1.0, 2.0], buckets=2, low=1.0, high=2.0)
    assert steps.dropped_bins(before, after) == [0.0, 0.0]


def test_dropped_bins_count_the_whole_bucket_when_nothing_stayed() -> None:
    """留下的那一份一根柱都没有时，进来的整桶都是被丢掉的。"""
    before = steps.spread_of([1.0, 2.0], buckets=2)
    assert steps.dropped_bins(before, steps.spread_of([])) == [1.0, 1.0]


def test_a_column_of_bins_carries_the_dropped_share_it_was_given() -> None:
    """逐桶的丢弃段原样挂到这一列上。"""
    bins = steps.column_bins(
        "温度", steps.spread_of([1.0, 2.0], buckets=2), dropped=[1.0, 0.0]
    )
    assert bins.dropped == [1.0, 0.0]


def test_attribution_ranks_the_culprits_and_skips_the_innocent() -> None:
    """归因按摊上的多少排，一格都没摊上的列不列。"""
    got = steps.by_column({"温度": 3, "湿度": 0, "负荷": 5}, whole=10)
    assert got == [
        {"key": "负荷", "count": 5, "ratio": 0.5},
        {"key": "温度", "count": 3, "ratio": 0.3},
    ]


def test_attribution_breaks_ties_by_column_key() -> None:
    """一样多时按列 key 排：不定的话同一次运行两次读出来的顺序不同。"""
    got = steps.by_column({"乙": 2, "甲": 2})
    assert [item["key"] for item in got] == ["乙", "甲"]


def test_attribution_stops_at_twelve_columns() -> None:
    """十二列封顶。"""
    counts = {f"c{index}": index + 1 for index in range(30)}
    assert len(steps.by_column(counts)) == 12


def test_a_ratio_with_no_denominator_is_none_not_zero() -> None:
    """分母为零是「算不出来」，不是「零」。"""
    assert steps.ratio_of(3, 0) is None
    assert steps.ratio_of(1, 8) == 0.125


def test_samples_are_cut_short_so_a_whole_note_cannot_leak() -> None:
    """样例值逐个截短：台账的文本列里可能是备注、联系人这类。"""
    got = steps.samples_of(["名" * 40, 5, None, "多出来的"])
    assert got == ["名" * 24 + "…", 5.0, None]


def test_a_sample_that_fits_is_left_alone() -> None:
    """截得下的原样带出去，不平白多一个省略号。"""
    assert steps.samples_of(["--"]) == ["--"]


def test_only_the_columns_that_really_changed_type_are_listed() -> None:
    """类型对照只列换过的那几列，没换的不占位置。"""
    got = steps.dtype_changes(
        {"温度": "string", "负荷": "number"},
        {"温度": "number", "负荷": "number"},
    )
    assert got == [{"key": "温度", "before": "string", "after": "number"}]


def test_a_moment_is_printed_as_utc() -> None:
    """时刻一律 UTC RFC3339：按本地时印会整体偏一个时区且每个数看着正常。"""
    assert steps.moment_text(0) == "1970-01-01T00:00:00+00:00"
