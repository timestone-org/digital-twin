"""出参转换的防御面：一格脏数据不许把整张台账打成 500。

⚠ 取值本身另有兜底（`effective.apply_overrides`），这里守的是**痕迹**那一侧：
半截的修正条目、类型不对的样本数与错误原因，一律不往外发而不是抛出去
（docs/DATASET_DESIGN.md §7.7）。
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from platform_server.apps.dataset.models import DatasetRecord
from platform_server.apps.dataset.services.presenters import to_record_out

MOMENT = datetime(2026, 8, 23, 10, 0, tzinfo=UTC)
TRACE_AT = "2026-08-23T10:05:00.000Z"


def make_record(**overrides: Any) -> DatasetRecord:
    """一行落了库的台账数据。"""
    fields: dict[str, Any] = {
        "table_id": uuid.uuid4(),
        "ts": MOMENT,
        "row_id": uuid.uuid4(),
        "values_json": {"温度": 20.0},
        "source": "manual",
        "created_at": MOMENT,
        "updated_at": MOMENT,
    }
    fields.update(overrides)
    return DatasetRecord(**fields)


def test_a_complete_trace_is_handed_out_as_is() -> None:
    record = make_record(
        overrides_json={
            "温度": {
                "v": 25.0,
                "by": "u-1",
                "by_name": "张三",
                "at": TRACE_AT,
                "reason": "仪表故障",
            }
        }
    )

    out = to_record_out(record)

    assert out.overrides is not None
    assert out.overrides["温度"].value == 25.0
    assert out.overrides["温度"].reason == "仪表故障"


def test_a_trace_without_a_timestamp_is_dropped_not_raised() -> None:
    # ⚠ 半截条目只可能是有人直接改了库；让它把整页列表打成 500，是拿一格脏
    # 数据毁掉整张台账
    record = make_record(overrides_json={"温度": {"v": 25.0}})

    assert to_record_out(record).overrides is None


def test_a_trace_that_is_not_an_object_is_dropped() -> None:
    record = make_record(overrides_json={"温度": "25"})

    assert to_record_out(record).overrides is None


def test_a_migrated_trace_without_an_author_still_shows_up() -> None:
    # ⚠ 数据迁移带进来的修正没有 by / by_name：丢掉它等于让那一格的角标消失，
    # 而那一格的值确实被改过
    record = make_record(overrides_json={"温度": {"v": 25.0, "at": TRACE_AT}})

    out = to_record_out(record)

    assert out.overrides is not None
    assert out.overrides["温度"].by_name is None


def test_a_row_without_corrections_gives_null_not_an_empty_object() -> None:
    # 出参契约：整行没修正就给 null，前端少判一层
    assert to_record_out(make_record()).overrides is None


def test_sample_counts_keep_only_the_entries_that_read_as_integers() -> None:
    # ⚠ `n = 0` 与「值为空」是两件事，故 0 必须留下；而真假值不是样本数
    record = make_record(samples_json={"温度": 0, "湿度": "多", "风速": True})

    assert to_record_out(record).samples == {"温度": 0}


def test_a_corrupt_samples_blob_is_treated_as_absent() -> None:
    record = make_record(samples_json=[1, 2])

    assert to_record_out(record).samples is None


def test_compute_errors_keep_only_the_readable_reasons() -> None:
    record = make_record(compute_error={"能耗": "类型不匹配", "产量": 7})

    assert to_record_out(record).compute_error == {"能耗": "类型不匹配"}
