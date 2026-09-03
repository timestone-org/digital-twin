"""绑定对的是**入口契约**，不是模型的特征列。

⚠ 两者在没有特征工程的链上恰好相等，所以这一族缺陷在最小闭环上完全看不出来。
一旦链上有一步改了列集（独热、时间特征、主成分），按特征列去核对的表现是：
绑定建得出来，一算就抛「实参个数对不上」——而那句话指向的地方与真正的问题
无关（docs/MODELING_PLATFORM_DESIGN.md D4 / D5 / D18）。
"""

from typing import Any

from platform_server.apps.modeling.services.formula_registration import (
    expression_of,
    param_names_of,
)
from platform_server.apps.modeling.services.model_schema import entry_keys_of

TEMPERATURE = "温度"
LOAD = "负荷"
DERIVED = "ts_hour"


class FakeVersion:
    """一个模型版本在这几个函数眼里的样子。

    ⚠ 形参与真行逐字对齐：假件比真行窄的话，读到一个真行上才有的字段会当场
    炸，而那条路只有真发布过才走得到。
    """

    def __init__(
        self, signature: dict[str, Any], feature_keys: list[str]
    ) -> None:
        self.signature_json = signature
        self.feature_keys = feature_keys
        self.name = "能耗模型"
        self.version = 3


def _signature(*columns: tuple[str, str]) -> dict[str, Any]:
    """一份只带入口列的签名。

    Args: columns（key 与显示名）。
    """
    return {"inputs": [{"key": key, "label": label} for key, label in columns]}


def test_the_entry_contract_wins_over_the_feature_list() -> None:
    """签名在的时候按签名走。

    ⚠ 这里两者**个数不同**——特征列多一列派生列，正是特征工程那一步造出来的。
    """
    version = _signature((TEMPERATURE, "环境温度"), (LOAD, "瞬时负荷"))
    assert entry_keys_of(version, [TEMPERATURE, LOAD, DERIVED]) == [
        TEMPERATURE,
        LOAD,
    ]


def test_an_old_version_falls_back_to_its_feature_list() -> None:
    """签名是空的（早于那次升级）就退回特征列。

    ⚠ 那时候入口契约与特征列本来就是同一份，退回去不会算错。
    """
    assert entry_keys_of({}, [TEMPERATURE, LOAD]) == [TEMPERATURE, LOAD]


def test_param_names_prefer_the_display_name() -> None:
    """形参名优先取台账列的显示名。"""
    version = FakeVersion(
        _signature((TEMPERATURE, "环境温度"), (LOAD, "瞬时负荷")),
        [TEMPERATURE, LOAD, DERIVED],
    )
    assert param_names_of(version) == [
        "环境温度",
        "瞬时负荷",
    ]


def test_an_illegal_display_name_falls_back_to_the_key() -> None:
    """显示名落不进形参名的字符集时退回列 key。

    ⚠ 显示名可以含空格与括号，而那些在形参名里是非法字符——不退回的话，
    注册出来的条目在落库那一步才被拒。
    """
    version = FakeVersion(
        _signature((TEMPERATURE, "环境 温度(℃)"), (LOAD, "瞬时负荷")),
        [TEMPERATURE, LOAD],
    )
    assert param_names_of(version) == [
        TEMPERATURE,
        "瞬时负荷",
    ]


def test_duplicated_display_names_fall_back_to_keys() -> None:
    """两列显示名撞了就都退回列 key。

    ⚠ 形参名是条目上的唯一标识，两个同名形参会让调用点上的第二个位置永远
    拿不到值。
    """
    version = FakeVersion(
        _signature((TEMPERATURE, "读数"), (LOAD, "读数")),
        [TEMPERATURE, LOAD],
    )
    assert param_names_of(version) == [
        TEMPERATURE,
        LOAD,
    ]


def test_the_expression_quotes_the_code() -> None:
    """公式体里的标识用单引号包着。

    ⚠ 它可能含中文与连字符，裸着写解析不出来。
    """
    assert expression_of("一键能耗", ["环境温度", "瞬时负荷"]) == (
        "PREDICT('一键能耗', {环境温度}, {瞬时负荷})"
    )


def test_the_param_order_follows_the_entry_order() -> None:
    """形参顺序就是入口契约的顺序。

    ⚠ 顺序就是契约：绑定按位置把形参落到入口列上，顺序错了不报错，只是算出
    别的数。
    """
    version = FakeVersion(
        _signature((LOAD, "瞬时负荷"), (TEMPERATURE, "环境温度")),
        [TEMPERATURE, LOAD],
    )
    assert param_names_of(version) == [
        "瞬时负荷",
        "环境温度",
    ]
