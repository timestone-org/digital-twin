"""台账的五组闭合取值：字面量、收窄器与 CHECK 渲染三者不许互相漂。

⚠ 放开成任意字符串的话，写歪的取值会照常入库、永远不出数、也不告警。
"""

from collections.abc import Callable

import pytest

from platform_server.apps.dataset import protocols

Narrower = Callable[[str], str]

CLOSED_SETS: tuple[tuple[str, ...], ...] = (
    protocols.COLLECT_MODES,
    protocols.COLUMN_SOURCES,
    protocols.COLUMN_TYPES,
    protocols.AGG_FUNCS,
    protocols.RECORD_SOURCES,
)
NARROWERS: tuple[tuple[Narrower, tuple[str, ...]], ...] = (
    (protocols.as_collect_mode, protocols.COLLECT_MODES),
    (protocols.as_column_source, protocols.COLUMN_SOURCES),
    (protocols.as_column_type, protocols.COLUMN_TYPES),
    (protocols.as_agg_func, protocols.AGG_FUNCS),
    (protocols.as_record_source, protocols.RECORD_SOURCES),
)


@pytest.mark.parametrize("values", CLOSED_SETS)
def test_every_closed_set_is_sorted_and_unique(values: tuple[str, ...]) -> None:
    # 排序写死，CHECK 约束的文本才不会随 get_args 的返回序抖动
    assert list(values) == sorted(set(values))


@pytest.mark.parametrize(("narrow", "values"), NARROWERS)
def test_every_narrower_accepts_every_member_of_its_set(
    narrow: Narrower, values: tuple[str, ...]
) -> None:
    assert [narrow(value) for value in values] == list(values)


@pytest.mark.parametrize(("narrow", "values"), NARROWERS)
def test_every_narrower_rejects_a_value_outside_its_set(
    narrow: Narrower, values: tuple[str, ...]
) -> None:
    assert "不在集合里" not in values
    with pytest.raises(protocols.UnknownLiteral):
        narrow("不在集合里")


def test_the_aggregation_whitelist_holds_exactly_eight_functions() -> None:
    # ⚠ 台账自己出一份 8 档白名单，不复用采集读侧那份 5 档的对外契约
    assert protocols.AGG_FUNCS == (
        "avg",
        "count",
        "delta",
        "first",
        "last",
        "max",
        "min",
        "sum",
    )


def test_the_middle_column_source_is_point_not_a_protocol_name() -> None:
    # ⚠ 列绑的是一个点位，与它背后跑的是哪个协议无关（ADR-0011）
    assert "point" in protocols.COLUMN_SOURCES
    assert "opcua" not in protocols.COLUMN_SOURCES


def test_sql_values_renders_a_quoted_literal_list() -> None:
    assert protocols.sql_values(("a", "b")) == "'a', 'b'"
