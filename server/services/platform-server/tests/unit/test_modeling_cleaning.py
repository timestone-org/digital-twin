"""不带拟合的清洗算子：类型归一、丢缺失、条件过滤。

⚠ 这一组反复验的是**空值不许被当成一个取值**：转不动的格子、筛不过的行、
判缺失的那一列，空值各有各的去向，而把它折成 0 会让「没测到」变成「测到 0」。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)

NUMBERS = "读数"
LABEL = "标记"


def _frame(
    rows: tuple[tuple[Any, ...], ...], *, dtype: str = "string"
) -> Frame:
    """两列的小帧：一列数值、一列按参数定类型。

    Args: rows, dtype。
    """
    return Frame(
        columns=(
            FrameColumn(key=NUMBERS, name=NUMBERS, dtype="number"),
            FrameColumn(key=LABEL, name=LABEL, dtype=dtype),
        ),
        rows=rows,
    )


def _run(code: str, frame: Frame, **config: Any) -> Frame:
    """跑一个算子，回它输出端口上的帧。

    Args: code, frame, config。
    """
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    produced = operator.run({"frame": frame})["frame"]
    assert isinstance(produced, Frame)
    return produced


def test_casting_to_number_also_changes_the_column_type() -> None:
    """转完类型，列定义上的类型要跟着改。

    ⚠ 只换值不改列定义的话，下游 `numbers_of` 仍按旧类型判，一列刚转好的数值
    会被当成文本拒掉。
    """
    frame = _frame(((1.0, "12.5"), (2.0, "3")))
    got = _run("cast_type", frame, columns=[LABEL], to="number")
    assert got.column_of(LABEL).dtype == "number"
    assert got.values_of(LABEL) == [12.5, 3.0]


def test_a_value_that_will_not_cast_becomes_blank_not_zero() -> None:
    """转不动的格子变成空值，不是 0——那会把「读不懂」变成「读到 0」。"""
    frame = _frame(((1.0, "十二"), (2.0, "3")))
    got = _run("cast_type", frame, columns=[LABEL], to="number")
    assert got.values_of(LABEL) == [None, 3.0]


def test_casting_can_be_asked_to_fail_loudly_instead() -> None:
    """挑明了要报错时就报错，并说清是哪一列的哪个值。"""
    frame = _frame(((1.0, "十二"),))
    with pytest.raises(OperatorError, match="十二"):
        _run("cast_type", frame, columns=[LABEL], to="number", on_error="error")


def test_a_blank_stays_blank_through_a_cast() -> None:
    """本来就是空的格子，转完还是空的。"""
    frame = _frame(((1.0, None),))
    got = _run("cast_type", frame, columns=[LABEL], to="number")
    assert got.values_of(LABEL) == [None]


def test_dropping_rows_looks_only_at_the_listed_columns() -> None:
    """只看点名的那几列：别的列有空不算数。"""
    frame = _frame(((1.0, None), (None, "甲"), (3.0, "乙")))
    got = _run("drop_missing", frame, axis="row", subset=[NUMBERS])
    assert got.values_of(NUMBERS) == [1.0, 3.0]


def test_dropping_rows_with_all_needs_every_listed_column_blank() -> None:
    """`all` 那一档要点名的列**全空**才丢。"""
    frame = _frame(((1.0, None), (None, None), (3.0, "乙")))
    got = _run("drop_missing", frame, axis="row", how="all")
    assert got.row_count == 2


def test_dropping_every_row_is_an_error_not_an_empty_frame() -> None:
    """一行都不剩时报错，不把一份空帧交给下游。"""
    frame = _frame(((None, None), (None, None)))
    with pytest.raises(OperatorError, match="每一行都被丢掉"):
        _run("drop_missing", frame, axis="row")


def test_dropping_columns_goes_by_the_null_ratio() -> None:
    """丢列那一档按空值率判，与 `how` 无关。"""
    frame = _frame(((1.0, None), (2.0, None), (3.0, "乙")))
    got = _run("drop_missing", frame, axis="col", max_null_ratio=0.5)
    assert got.keys == (NUMBERS,)


def test_dropping_columns_makes_the_column_set_unknowable() -> None:
    """丢列那一档静态推不出列集——丢谁取决于数据。

    ⚠ 声明成「原样透传」的话，下游的列候选会列出已经被丢掉的列，而用户勾了
    要等运行时才报「没有这一列」。
    """
    operator = registry.get("drop_missing")
    given = {"frame": (NUMBERS, LABEL)}
    by_row = operator.describe_columns(
        operator.CONFIG_MODEL.model_validate({"axis": "row"}), given
    )
    by_col = operator.describe_columns(
        operator.CONFIG_MODEL.model_validate({"axis": "col"}), given
    )
    assert by_row["frame"] == (NUMBERS, LABEL)
    assert by_col["frame"] is None


def test_filtering_keeps_the_rows_that_pass() -> None:
    """比较那几档按数值比。"""
    frame = _frame(((1.0, "甲"), (5.0, "乙"), (9.0, "丙")))
    got = _run("filter_rows", frame, column=NUMBERS, op="gte", value=5.0)
    assert got.values_of(NUMBERS) == [5.0, 9.0]


def test_a_blank_never_passes_a_comparison() -> None:
    """空值在比较那几档里一律不留。

    ⚠ 拿它当 0 去比会静默把「没测到」当成一个真实取值。
    """
    frame = _frame(((None, "甲"), (5.0, "乙")))
    got = _run("filter_rows", frame, column=NUMBERS, op="lte", value=100.0)
    assert got.values_of(NUMBERS) == [5.0]


def test_filtering_on_blankness_works_on_any_column() -> None:
    """`is_blank` / `not_blank` 两档不看类型，文本列也用得上。"""
    frame = _frame(((1.0, None), (2.0, "乙")))
    got = _run("filter_rows", frame, column=LABEL, op="not_blank")
    assert got.values_of(LABEL) == ["乙"]


def test_filtering_everything_away_is_an_error() -> None:
    """筛下来一行都不剩时报错，并指名是哪一列那一条太紧。"""
    frame = _frame(((1.0, "甲"),))
    with pytest.raises(OperatorError, match=NUMBERS):
        _run("filter_rows", frame, column=NUMBERS, op="gt", value=100.0)


def test_comparing_a_text_column_is_refused() -> None:
    """比较那几档只认数值列，文本列当场拒掉而不是硬比。"""
    frame = _frame(((1.0, "甲"),))
    with pytest.raises(OperatorError, match="数值列"):
        _run("filter_rows", frame, column=LABEL, op="gte", value=1.0)
