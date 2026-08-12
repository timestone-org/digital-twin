"""数据集目录与数据源对象名校验的纯逻辑。

⚠ 对象名最终要拼进 SQL（标识符不能参数化），故这里的白名单是一道真实的注入
防线，不是格式美化。
"""

import pytest

from platform_server.apps.hvac.datasets import (
    DATASET_RAW_MINUTE,
    dataset_keys,
    find_dataset,
    limitable_metric_keys,
    metric_keys,
)
from platform_server.apps.hvac.errors import SourceObjectInvalid
from platform_server.apps.hvac.services.ac_data_service import (
    ensure_valid_source_object,
)


def test_the_raw_minute_dataset_lists_all_nineteen_source_columns() -> None:
    dataset = find_dataset(DATASET_RAW_MINUTE)
    assert dataset is not None
    keys = metric_keys(dataset)
    assert len(keys) == 19
    assert keys[0] == "workshop_temp_avg"
    assert keys[-1] == "fan_frequency"
    # 顺序即展示顺序，重复列名会让前端的表头与取值错位
    assert len(set(keys)) == 19


def test_an_unknown_dataset_key_resolves_to_none() -> None:
    assert find_dataset("hourly_energy") is None
    assert dataset_keys() == frozenset({DATASET_RAW_MINUTE})


def test_only_the_two_workshop_metrics_accept_limits() -> None:
    assert limitable_metric_keys() == frozenset(
        {"workshop_temp_avg", "workshop_humidity_avg"}
    )


@pytest.mark.parametrize(
    "name",
    [
        "KTStartData_K01",
        "KTkgj",
        "a",
        "A1_2",
        "K" * 128,
    ],
)
def test_a_plain_identifier_is_accepted(name: str) -> None:
    assert ensure_valid_source_object(name) == name


@pytest.mark.parametrize(
    "name",
    [
        "",
        "K" * 129,
        "KT-01",
        "KT 01",
        "KT;DROP TABLE x",
        "KT'01",
        "[KT01]",
        "dbo.KT01",
        "KTStartData_K01\n",
        "\nKTStartData_K01",
        "中文视图",
    ],
)
def test_anything_that_is_not_a_bare_identifier_is_rejected(name: str) -> None:
    with pytest.raises(SourceObjectInvalid):
        ensure_valid_source_object(name)
