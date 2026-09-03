"""独热编码：类目在训练行上定，推理时回灌。

⚠ 这一组盯的是**列名的确定性**：编出来的列名由类目决定，而类目的顺序若靠集合
迭代，同一份数据在不同进程上会编出不同的列名——两次训练各自看着都对。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)

LABEL = "工况"
VALUE = "读数"


def _frame(labels: list[str | None]) -> Frame:
    """一列类目、一列数值。

    Args: labels。
    """
    return Frame(
        columns=(
            FrameColumn(key=LABEL, name="工况", dtype="string"),
            FrameColumn(key=VALUE, name=VALUE, dtype="number"),
        ),
        rows=tuple((label, float(index)) for index, label in enumerate(labels)),
    )


def _built(**config: Any) -> Any:
    operator, _ = registry.build("one_hot", config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    return operator


def _encoded(frame: Frame, **config: Any) -> Frame:
    produced = _built(**config).run({"frame": frame})["frame"]
    assert isinstance(produced, Frame)
    return produced


def test_a_category_column_becomes_flag_columns() -> None:
    """原列换成一组 0/1 列，原列不再在帧上。"""
    got = _encoded(_frame(["甲", "乙", "甲"]), columns=[LABEL])
    assert got.keys == ("工况=甲", "工况=乙", VALUE)
    assert got.values_of("工况=甲") == [1.0, 0.0, 1.0]
    assert got.values_of("工况=乙") == [0.0, 1.0, 0.0]


def test_the_column_order_follows_how_often_each_category_shows_up() -> None:
    """类目按出现次数排，同频按字典序——顺序必须是确定的。

    ⚠ 靠集合迭代顺序的话，同一份数据在不同进程上编出不同的列名。
    """
    got = _encoded(_frame(["乙", "甲", "甲"]), columns=[LABEL])
    assert got.keys[:2] == ("工况=甲", "工况=乙")


def test_a_blank_becomes_all_zeros() -> None:
    """空值落全零，不单独编一类。"""
    got = _encoded(_frame(["甲", None]), columns=[LABEL])
    assert got.values_of("工况=甲") == [1.0, 0.0]


def test_an_unseen_category_falls_to_all_zeros_at_serving() -> None:
    """推理时遇到没见过的类目落全零，不报错。

    ⚠ 线上出现新类目是常态，为它拒绝整次预测比给一个「哪一类都不是」更糟。
    """
    trained = _built(columns=[LABEL])
    trained.run({"frame": _frame(["甲", "乙"])})
    served = _built(columns=[LABEL])
    served.load_fitted(trained.dump_fitted() or {})
    got = served.run({"frame": _frame(["丙"])})["frame"]
    assert got.values_of("工况=甲") == [0.0]
    assert got.values_of("工况=乙") == [0.0]


def test_the_categories_round_trip() -> None:
    """训出来的类目回灌得进去，编出来的列名一模一样。"""
    trained = _built(columns=[LABEL])
    trained.run({"frame": _frame(["甲", "乙"])})
    dumped = trained.dump_fitted() or {}
    served = _built(columns=[LABEL])
    served.load_fitted(dumped)
    assert served.dump_fitted() == dumped


def test_too_many_categories_are_refused_by_default() -> None:
    """类目超过上限时默认报错，并说清该怎么办。"""
    with pytest.raises(OperatorError, match="超过了上限"):
        _encoded(_frame(["甲", "乙", "丙"]), columns=[LABEL], max_categories=2)


def test_only_the_most_common_can_be_kept_instead() -> None:
    """挑明了只留最常见的那几个时就只留那几个，其余落全零。"""
    got = _encoded(
        _frame(["甲", "甲", "甲", "乙", "乙", "丙"]),
        columns=[LABEL],
        max_categories=2,
        on_many_categories="keep_top",
    )
    assert got.keys[:2] == ("工况=甲", "工况=乙")
    # 丙 被挤掉了，它那一行落全零
    assert got.values_of("工况=甲")[-1] == 0.0
    assert got.values_of("工况=乙")[-1] == 0.0


def test_categories_with_the_same_count_break_the_tie_by_code_point() -> None:
    """同频时按码点排。

    ⚠ 「字典序」在中文上不是直觉里那个顺序（丙 U+4E19 在 乙 U+4E59 之前），
    但**是不是直觉**不重要——重要的是它是确定的：靠集合迭代顺序的话，同一份
    数据在不同进程上编出不同的列名，而两次训练各自看着都对。
    """
    got = _encoded(_frame(["b", "a"]), columns=[LABEL])
    assert got.keys[:2] == ("工况=a", "工况=b")


def test_the_produced_columns_cannot_be_derived_statically() -> None:
    """声明说「推不出来」——编出来几列取决于数据里有哪些类目。

    ⚠ 声明成原样透传的话，下游的列候选里会留着已经被编掉的原列。
    """
    operator = registry.get("one_hot")
    config = operator.CONFIG_MODEL.model_validate({"columns": [LABEL]})
    declared = operator.describe_columns(config, {"frame": (LABEL, VALUE)})
    assert declared["frame"] is None


def test_a_column_with_no_category_is_refused() -> None:
    """训练行上一个类目都没有时说清楚，不编出零列。"""
    with pytest.raises(OperatorError, match="一个类目都没有"):
        _encoded(_frame([None, None]), columns=[LABEL])
