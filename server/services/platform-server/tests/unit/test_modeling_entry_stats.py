"""入口列的训练期统计：摘要里没有的统计不冒充成 0。

⚠ 冒充成 `min=max=0` 的话，每一次带非零值的预测都会报「超出训练区间」。
"""

from platform_server.apps.modeling.services.entry_contract import _entry_column
from platform_server.apps.modeling.services.open_model_service import (
    _is_outside,
)


def test_a_column_without_stats_freezes_no_range() -> None:
    column = _entry_column("温度", {})
    assert column.stats == {}
    assert not _is_outside(5.0, dict(column.stats))


def test_an_all_null_column_keeps_only_the_stats_it_has() -> None:
    column = _entry_column(
        "温度", {"温度": {"min": None, "max": None, "null_ratio": 1.0}}
    )
    assert column.stats == {"null_ratio": 1.0}


def test_real_stats_are_kept() -> None:
    column = _entry_column(
        "温度", {"温度": {"min": 1, "max": 9.5, "p50": 4.0, "null_ratio": 0}}
    )
    assert column.stats == {
        "min": 1.0,
        "max": 9.5,
        "p50": 4.0,
        "null_ratio": 0.0,
    }
    assert _is_outside(10.0, dict(column.stats))
