"""写入三分派与值清洗：公式列拒收、录入列落原值、点位列落人工修正。

⚠ 这一层守的是「提交为空」与「改成空」的分界（docs/DATASET_DESIGN.md §8.4）：
点位汇总列显式提交为空是**撤销修正**，而人工录入列提交为空就是把值改成空。
"""

import uuid
from typing import Any

import pytest

from platform_server.apps.dataset.errors import DatasetRecordInvalid
from platform_server.apps.dataset.models import DatasetColumn
from platform_server.apps.dataset.services.record_values import (
    Actor,
    coerce,
    merge_overrides,
    merge_values,
    sanitize,
)

ACTOR = Actor(user_id="u-1", name="张三")


def column(key: str, **overrides: Any) -> DatasetColumn:
    """一列最小可用的定义。"""
    fields: dict[str, Any] = {
        "table_id": uuid.uuid4(),
        "key": key,
        "name": key,
        "data_type": "number",
        "source": "manual",
        "agg": "avg",
        "order_index": 0,
        "is_required": False,
    }
    fields.update(overrides)
    return DatasetColumn(**fields)


def test_a_formula_column_is_never_written_from_a_submission() -> None:
    # ⚠ 公式列的值只能由公式算出来：收下提交的值等于让人绕开公式改结果
    columns = [column("能耗", source="formula", formula="1 + 1")]

    result = sanitize({"能耗": 5}, columns, actor=ACTOR)

    assert result.values == {}
    assert result.overrides == {}


def test_a_point_column_goes_to_the_override_channel() -> None:
    columns = [column("温度", source="point", node_key="s:t")]

    result = sanitize({"温度": 25}, columns, actor=ACTOR)

    assert result.values == {}
    assert result.overrides["温度"]["v"] == 25.0
    assert result.overrides["温度"]["by_name"] == "张三"


def test_an_empty_point_value_revokes_the_correction() -> None:
    # ⚠ 「提交为空」与「改成空」是两件事：混成一件的话，用户撤了一格却会
    # 看到「已修正 1 格」
    columns = [column("温度", source="point", node_key="s:t")]

    result = sanitize({"温度": ""}, columns, actor=ACTOR)

    assert result.overrides == {}
    assert result.cleared == frozenset({"温度"})


def test_a_point_column_never_takes_a_default_value() -> None:
    # ⚠ 点位汇总列只认显式提交的 key：套默认值等于凭空造一条人工修正
    columns = [column("温度", source="point", node_key="s:t", default_value=1)]

    result = sanitize({}, columns, actor=ACTOR)

    assert result.overrides == {}
    assert result.cleared == frozenset()


def test_a_missing_manual_column_falls_back_to_its_default() -> None:
    columns = [column("班次", data_type="string", default_value="早班")]

    result = sanitize({}, columns, actor=ACTOR)

    assert result.values == {"班次": "早班"}
    assert result.submitted == frozenset()


def test_a_required_manual_column_must_be_filled() -> None:
    columns = [column("产量", is_required=True)]

    with pytest.raises(DatasetRecordInvalid):
        sanitize({}, columns, actor=ACTOR)


def test_a_required_point_column_is_not_part_of_that_check() -> None:
    # ⚠ 点位汇总列的值由采集器填，必填校验加在它头上会让每一次人工录入都失败
    columns = [column("温度", source="point", node_key="s:t", is_required=True)]

    assert sanitize({}, columns, actor=ACTOR).values == {}


def test_a_non_numeric_value_for_a_number_column_is_rejected() -> None:
    with pytest.raises(DatasetRecordInvalid):
        coerce("abc", column("产量"))


def test_an_infinite_number_is_rejected_before_it_reaches_jsonb() -> None:
    # ⚠ inf / NaN 会被 json.dumps 写成 Infinity / NaN，PG 的 jsonb 直接拒收，
    # 整行录入于是失败在一条与用户输入毫不相干的报错上
    with pytest.raises(DatasetRecordInvalid):
        coerce("inf", column("产量"))


def test_an_oversized_integer_is_rejected_instead_of_crashing() -> None:
    # ⚠ 任意精度整数走 float() 抛的是 OverflowError，漏接就穿透成 500
    with pytest.raises(DatasetRecordInvalid):
        coerce("9" * 400, column("产量"))


def test_chinese_words_are_accepted_for_a_boolean_column() -> None:
    assert coerce("是", column("合格", data_type="bool")) is True
    assert coerce("否", column("合格", data_type="bool")) is False


def test_a_blank_string_is_an_empty_value_not_a_zero() -> None:
    assert coerce("   ", column("产量")) is None


def test_a_none_value_stays_empty_for_every_type() -> None:
    assert coerce(None, column("产量")) is None
    assert coerce(None, column("班次", data_type="string")) is None


def test_a_boolean_submitted_to_a_number_column_becomes_one_or_zero() -> None:
    # ⚠ 布尔要在 float() 之前拦下：`float(True)` 是 1.0，但 `float` 对
    # 别的真假写法一律抛错，两条路给出的答案会不一致
    assert coerce(True, column("产量")) == 1.0
    assert coerce(False, column("产量")) == 0.0


def test_a_number_submitted_to_a_boolean_column_reads_as_nonzero() -> None:
    assert coerce(0, column("合格", data_type="bool")) is False
    assert coerce(2, column("合格", data_type="bool")) is True


def test_an_unrecognised_word_for_a_boolean_column_is_rejected() -> None:
    with pytest.raises(DatasetRecordInvalid):
        coerce("大概吧", column("合格", data_type="bool"))


def test_a_non_string_value_for_a_text_column_is_stringified() -> None:
    assert coerce(7, column("班次", data_type="string")) == "7"


def test_editing_one_column_keeps_the_other_stored_values() -> None:
    # ⚠ 整体覆盖会抹掉点位汇总列的采集原值与已删列的残值：前者让这一行的
    # 自动值凭空消失，后者让「把列加回来」再也找不回历史
    columns = [column("产量"), column("温度", source="point", node_key="s:t")]
    result = sanitize({"产量": 7}, columns, actor=ACTOR)

    merged = merge_values({"产量": 3.0, "温度": 20.0, "旧列": "x"}, result)

    assert merged == {"产量": 7.0, "温度": 20.0, "旧列": "x"}


def test_an_unsubmitted_manual_column_is_not_reset_to_its_default() -> None:
    # ⚠ 只覆盖显式提交过的键：不然一次只改一列的编辑会把别的列重置成默认值
    columns = [
        column("产量"),
        column("班次", data_type="string", default_value="早班"),
    ]
    result = sanitize({"产量": 7}, columns, actor=ACTOR)

    merged = merge_values({"产量": 3.0, "班次": "夜班"}, result)

    assert merged == {"产量": 7.0, "班次": "夜班"}


def test_merging_overrides_drops_only_the_ones_submitted_empty() -> None:
    columns = [
        column("温度", source="point", node_key="s:t"),
        column("湿度", source="point", node_key="s:h"),
    ]
    result = sanitize({"温度": ""}, columns, actor=ACTOR)

    merged = merge_overrides({"温度": {"v": 25.0}, "湿度": {"v": 40.0}}, result)

    assert set(merged) == {"湿度"}
