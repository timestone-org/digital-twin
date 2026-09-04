"""结果面讲解的预算用例：五档降级、主体图最后丢、运行级记账。

⚠ 「主体图最后丢」那一条是本文件的重点：先丢全部大数组的话，最需要解释的那类
运行（宽、长、列多）的旗舰图会第一个被斩掉
（docs/MODELING_RESULT_VIEW_DESIGN.md §4.6）。
"""

from typing import Any

from platform_server.apps.modeling.operators.reporting import (
    TIER_LARGE,
    TIER_SCALAR,
    TIER_SMALL,
    ReportBlock,
)
from platform_server.apps.modeling.services.preview import (
    REPORT_MAX_BYTES,
    RUN_REPORT_MAX_BYTES,
)
from platform_server.apps.modeling.services.report_budget import (
    OVERSIZE_NOTE,
    RUN_OVERSIZE_NOTE,
    RunReportBudget,
    fit_report,
    size_of,
)

# 一块就顶穿单节点上限的填充量
HUGE = REPORT_MAX_BYTES + 8 * 1024
# 两块加起来才顶穿的填充量
HALF = REPORT_MAX_BYTES * 2 // 3


def block(
    title: str,
    *,
    zone: Any = "charts",
    tier: int = TIER_SCALAR,
    weight: int = 0,
    is_primary: bool = True,
) -> ReportBlock:
    """造一块指定份量的块。

    Args: title, zone, tier, weight（填充字节）, is_primary。
    """
    payload: dict[str, Any] = {"is_primary": is_primary}
    if weight:
        payload["filler"] = "x" * weight
    return ReportBlock(
        kind="bins",
        zone=zone,
        port="",
        title=title,
        tier=tier,
        payload=payload,
    )


def gist() -> ReportBlock:
    """第一区那几行标量。任何一档都不许丢它。"""
    return block("这一步做了什么", zone="step", tier=TIER_SCALAR)


def titles(report: dict[str, Any] | None) -> list[str]:
    """留下来的块都叫什么。

    Args: report。
    """
    assert report is not None
    return [item["title"] for item in report["blocks"]]


def test_no_blocks_at_all_stays_null() -> None:
    """一块都没有就回 None。

    那一列可空，NULL 的旧行与「这一步没有讲解」在界面上本来就是同一个样子。
    """
    assert fit_report(()) is None


def test_a_report_within_budget_is_kept_verbatim() -> None:
    """没超上限的原样落库，不留痕、不加说明。"""
    report = fit_report((gist(), block("分布", tier=TIER_LARGE)))
    assert report is not None
    assert titles(report) == ["这一步做了什么", "分布"]
    assert report["dropped"] == []
    assert report["note"] == ""
    assert size_of(report) <= REPORT_MAX_BYTES


def test_the_first_rung_drops_bulky_tables() -> None:
    """档 1：明细表里的大数组先走，第一区原封不动。"""
    report = fit_report(
        (gist(), block("逐列明细", zone="table", tier=TIER_LARGE, weight=HUGE))
    )
    assert titles(report) == ["这一步做了什么"]
    assert report is not None
    assert report["dropped"] == ["逐列明细"]
    assert report["note"] == ""


def test_the_second_rung_drops_auxiliary_charts() -> None:
    """档 2：图区里的辅图。"""
    report = fit_report(
        (
            gist(),
            block("辅图", tier=TIER_LARGE, weight=HUGE, is_primary=False),
        )
    )
    assert titles(report) == ["这一步做了什么"]
    assert report is not None
    assert report["dropped"] == ["辅图"]


def test_the_main_chart_outlives_the_auxiliary_one() -> None:
    """⚠ 主体图最后丢：两张图一起超预算时，先斩的必须是辅图。

    反过来（先丢全部 tier 2）的话，最需要解释的那类运行——宽、长、列多——的
    旗舰图 100% 不出现。
    """
    report = fit_report(
        (
            gist(),
            block("主体图", tier=TIER_LARGE, weight=HALF),
            block("辅图", tier=TIER_LARGE, weight=HALF, is_primary=False),
        )
    )
    assert titles(report) == ["这一步做了什么", "主体图"]
    assert report is not None
    assert report["dropped"] == ["辅图"]


def test_a_chart_without_a_primary_flag_counts_as_the_main_one() -> None:
    """没写主次的一律当主体图：默认值要站在「最后才丢」这一边。"""
    unmarked = ReportBlock(
        kind="bins",
        zone="charts",
        port="",
        title="没写主次",
        tier=TIER_LARGE,
        payload={"filler": "x" * HALF},
    )
    report = fit_report(
        (
            gist(),
            unmarked,
            block("辅图", tier=TIER_LARGE, weight=HALF, is_primary=False),
        )
    )
    assert titles(report) == ["这一步做了什么", "没写主次"]


def test_the_third_rung_drops_small_arrays_outside_the_first_zone() -> None:
    """档 3：第一区之外的小数组。"""
    report = fit_report(
        (gist(), block("指标卡", zone="stats", tier=TIER_SMALL, weight=HUGE))
    )
    assert titles(report) == ["这一步做了什么"]
    assert report is not None
    assert report["dropped"] == ["指标卡"]
    assert report["note"] == ""


def test_the_last_rung_keeps_only_the_gist_and_says_so() -> None:
    """档 4：只剩第一区的标量块，并留一句话——不说的话界面看着像本来就没有。"""
    report = fit_report((gist(), block("主体图", tier=TIER_LARGE, weight=HUGE)))
    assert titles(report) == ["这一步做了什么"]
    assert report is not None
    assert report["dropped"] == ["主体图"]
    assert report["note"] == OVERSIZE_NOTE


def test_even_the_gist_gives_way_when_it_alone_blows_the_budget() -> None:
    """第一区自己就顶穿时也得让路，但谁被丢了仍然记着。"""
    report = fit_report((block("巨块", zone="step", weight=HUGE * 2),))
    assert report is not None
    assert report["blocks"] == []
    assert report["dropped"] == ["巨块"]
    assert report["note"] == OVERSIZE_NOTE
    assert size_of(report) <= REPORT_MAX_BYTES


def test_every_rung_re_measures_before_giving_up_more() -> None:
    """每降一档复量一次：一档就够时不许把后面几档也一起执行了。"""
    report = fit_report(
        (
            gist(),
            block("逐列明细", zone="table", tier=TIER_LARGE, weight=HUGE),
            block("指标卡", zone="stats", tier=TIER_SMALL),
        )
    )
    assert titles(report) == ["这一步做了什么", "指标卡"]


def test_the_run_budget_counts_actual_bytes() -> None:
    """运行级按实际字节记账：几十份小讲解不该把预算记满。"""
    budget = RunReportBudget()
    kept = [budget.take(fit_report((gist(),))) for _ in range(200)]
    assert all(item is not None and item["note"] == "" for item in kept)


def test_the_run_budget_swaps_the_overflow_for_a_stub() -> None:
    """预算用满之后换成桩：块全丢、谁被丢了与为什么都还在。"""
    budget = RunReportBudget()
    heavy = fit_report((gist(), block("主体图", weight=HALF)))
    rounds = RUN_REPORT_MAX_BYTES // HALF + 2
    taken = [budget.take(heavy) for _ in range(rounds)]
    stubs = [
        item for item in taken if item and item["note"] == RUN_OVERSIZE_NOTE
    ]
    assert stubs
    assert stubs[0]["blocks"] == []
    assert stubs[0]["dropped"] == ["这一步做了什么", "主体图"]


def test_the_run_budget_lets_a_missing_report_through() -> None:
    """这一步本来就没有讲解时，不许被换成桩。"""
    assert RunReportBudget().take(None) is None
