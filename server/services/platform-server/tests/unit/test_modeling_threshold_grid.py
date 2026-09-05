"""阈值网格上滑杆默认停的那一档，与 ② 区那张指标卡是不是同一刀。

⚠ 只有真链路规模的夹具分得出这一条：网格是从全部不同概率值上抽 59 档抽出来
的，四行的小夹具根本不触发抽样，「默认档就是打分那一档」在那上面恒成立
（docs/MODELING_RESULT_VIEW_DESIGN.md §13.3）。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    registry,
)
from platform_server.apps.modeling.operators.evalcurves import GRID_POINTS
from platform_server.apps.modeling.operators.frame import ROLE_TARGET
from platform_server.apps.modeling.operators.reporting import ReportBlock

HOUR_MS = 3_600_000
# 真链路那一档规模：160 行、160 个各不相同的概率，59 档必然抽掉一批
ROWS = 160
# 温度过了它就算超标
CUT = 5.9
# 这几行的标签翻面，好让打分帧上真有判错的行：全判对的话四格里两格恒为 0
FLIPPED = frozenset({31, 77, 101, 133})
# 逻辑回归打分时配的那个阈值。⚠ 分类评估拿不到它，只能从打分帧上反推
SCORING_THRESHOLD = 0.5


def label_of(seat: int) -> float:
    """第几行的真实类目；翻面的那几行取反。

    Args: seat。
    """
    high = seat / 10.0 > CUT
    return float(not high) if seat in FLIPPED else float(high)


def trained() -> Frame:
    """一份 160 行的两类数据，逻辑回归拿它训、也拿它打分。"""
    return Frame(
        columns=(
            FrameColumn(key="温度", name="温度", dtype="number"),
            FrameColumn(
                key="是否超标",
                name="是否超标",
                dtype="number",
                role=ROLE_TARGET,
            ),
        ),
        rows=tuple((seat / 10.0, label_of(seat)) for seat in range(ROWS)),
        index=tuple(seat * HOUR_MS for seat in range(ROWS)),
    )


def scored() -> Frame:
    """整条链路走一遍，交回那份带每行概率的打分帧。"""
    model, _ = registry.build(
        "logistic_regression", {"positive_threshold": SCORING_THRESHOLD}
    )
    model.bind_runtime(tz_offset_minutes=480, split_plan=None)
    made = model.run({"train": trained(), "test": trained()})["scored"]
    assert isinstance(made, Frame)
    return made


def reported(frame: Frame) -> tuple[ReportBlock, ...]:
    """拿分类评估讲一遍这份打分帧。

    Args: frame。
    """
    operator, _ = registry.build("classification_metrics", {})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"scored": frame})
    return operator.report()


def block_of(blocks: tuple[ReportBlock, ...], title: str) -> ReportBlock:
    """按标题取一块；取不到就当场说清是哪一块没了。

    Args: blocks, title。
    """
    for block in blocks:
        if block.title == title:
            return block
    raise AssertionError(f"讲解里没有「{title}」这一块")


def items_of(blocks: tuple[ReportBlock, ...], title: str) -> list[Any]:
    """一块按项的数里的那几项。

    Args: blocks, title。
    """
    payload: list[Any] = block_of(blocks, title).payload["items"]
    return payload


def marked_tick(blocks: tuple[ReportBlock, ...]) -> dict[str, Any]:
    """网格上竖线站的那一档；抽样把它抽掉了就当场说清。

    Args: blocks。
    """
    baseline = block_of(blocks, "阈值网格").payload["baseline"]
    for point in items_of(blocks, "阈值网格"):
        if point["threshold"] == baseline:
            return point
    raise AssertionError(f"网格上没有打分那一档 {baseline}，滑杆只能就近站")


def scoring_cells(frame: Frame) -> tuple[int, int, int, int]:
    """打分帧上直接数出来的 (TP, FP, TN, FN)，也就是 ② 区那张卡站的四格。

    ⚠ 独立数一遍，不问网格要：拿网格的数去核网格等于什么都没核。
    Args: frame。
    """
    pairs = [(row[0] == 1.0, row[1] == 1.0) for row in frame.rows]
    return (
        sum(1 for actual, guess in pairs if actual and guess),
        sum(1 for actual, guess in pairs if not actual and guess),
        sum(1 for actual, guess in pairs if not actual and not guess),
        sum(1 for actual, guess in pairs if actual and not guess),
    )


def test_the_fixture_has_more_distinct_probabilities_than_ticks() -> None:
    """⚠ 夹具先得触发抽样：不同概率不比档数多的话，这一整个文件恒绿。"""
    frame = scored()
    assert len({row[2] for row in frame.rows}) == ROWS
    assert ROWS > GRID_POINTS


def test_the_sampled_grid_still_carries_the_scoring_tick() -> None:
    """打分那一档在抽样后仍在网格上，且没把档数撑出上限。"""
    blocks = reported(scored())
    assert len(items_of(blocks, "阈值网格")) == GRID_POINTS
    assert marked_tick(blocks)["threshold"] == pytest.approx(
        block_of(blocks, "阈值网格").payload["baseline"]
    )


def test_the_default_tick_is_the_one_the_metrics_card_stands_on() -> None:
    """滑杆默认那一档的四格 = 打分帧上直接数出来的四格，一格都不差。

    ⚠ 差一格就是同一屏摆出两张混淆矩阵：② 区一张、⑤ 区一张，数还不一样。
    """
    frame = scored()
    point = marked_tick(reported(frame))
    four = (point["tp"], point["fp"], point["tn"], point["fn"])
    assert four == scoring_cells(frame)


def test_the_default_tick_prints_the_same_four_ratios_as_the_card() -> None:
    """四个比率也一字不差：卡片与滑杆是同一刀，不许各印一套。"""
    blocks = reported(scored())
    point = marked_tick(blocks)
    card = {item["key"]: item["value"] for item in items_of(blocks, "分类指标")}
    total = point["tp"] + point["fp"] + point["tn"] + point["fn"]
    guessed = point["tp"] + point["fp"]
    real = point["tp"] + point["fn"]
    assert (point["tp"] + point["tn"]) / total == pytest.approx(
        card["accuracy"]
    )
    assert point["tp"] / guessed == pytest.approx(card["precision"])
    assert point["tp"] / real == pytest.approx(card["recall"])
    assert point["value"] == pytest.approx(card["f1"])
