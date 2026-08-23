"""取值口径：人工修正优先于原值，且**只有一份实现**。

⚠ 这一层守的是「谁改的这一格」永远答得出来：`values_json` 里的采集原值一个字
不动、修正独占 `overrides_json`、公式结果独占 `computed_json`
（docs/DATASET_DESIGN.md D4 与 §4.3a）。
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from platform_server.apps.dataset.models import DatasetRecord
from platform_server.apps.dataset.services.effective import (
    apply_overrides,
    effective_merged,
    effective_values,
    to_snapshot,
)

MOMENT = datetime(2026, 8, 23, 10, 0, tzinfo=UTC)


def make_record(**overrides: Any) -> DatasetRecord:
    """一行最小可用的台账数据。"""
    fields: dict[str, Any] = {
        "table_id": uuid.uuid4(),
        "ts": MOMENT,
        "row_id": uuid.uuid4(),
        "values_json": {},
        "source": "manual",
    }
    fields.update(overrides)
    return DatasetRecord(**fields)


def test_a_correction_wins_over_the_collected_value() -> None:
    record = make_record(
        values_json={"温度": 20.0}, overrides_json={"温度": {"v": 25.0}}
    )

    assert effective_values(record) == {"温度": 25.0}


def test_the_collected_value_is_kept_untouched_underneath() -> None:
    # ⚠ 原值一个字都不动是全部口径的地基：改公式重算只覆盖计算值、采集只覆盖
    # 原值，谁都抹不掉另一方
    record = make_record(
        values_json={"温度": 20.0}, overrides_json={"温度": {"v": 25.0}}
    )

    effective_values(record)

    assert record.values_json == {"温度": 20.0}


def test_a_correction_of_zero_still_wins() -> None:
    # ⚠ 0 与「没有修正」是两件事：按真假判会让「人工改成 0」静默退回自动值
    record = make_record(
        values_json={"产量": 12.0}, overrides_json={"产量": {"v": 0}}
    )

    assert effective_values(record) == {"产量": 0}


def test_a_half_written_correction_falls_back_to_the_original() -> None:
    # ⚠ 撤销修正走的是删条目，留一个空的 v 只可能是有人直接改了库；当成
    # 「修正成空」的话，这一格会显示成空白而原值明明还在
    record = make_record(
        values_json={"温度": 20.0}, overrides_json={"温度": {"by": "甲"}}
    )

    assert effective_values(record) == {"温度": 20.0}


def test_formula_results_override_the_original_even_when_empty() -> None:
    # ⚠ 公式列算出空也算数：一列从录入列改成公式列之后 values_json 里的旧值
    # 还留着，回落会让它借尸还魂
    record = make_record(
        values_json={"能耗": 99.0}, computed_json={"能耗": None}
    )

    assert effective_merged(record) == {"能耗": None}


def test_a_snapshot_reads_the_same_values_the_row_does() -> None:
    # ⚠ 历史邻居与本行必须同口径：分叉的话同一列会在「本行」与「PREV 里的
    # 本行」取到两个不同的数
    record = make_record(
        values_json={"温度": 20.0},
        overrides_json={"温度": {"v": 25.0}},
        computed_json={"体感": 27.0},
    )

    snapshot = to_snapshot(record)

    assert snapshot.ts == MOMENT
    assert snapshot.values == {"温度": 25.0, "体感": 27.0}


def test_a_corrupt_overrides_blob_is_treated_as_no_correction() -> None:
    assert apply_overrides({"温度": 20.0}, None) == {"温度": 20.0}
