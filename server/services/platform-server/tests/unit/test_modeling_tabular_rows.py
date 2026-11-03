"""行筛选、分组与两表组合的顺序、缺失和容量契约。"""

from dataclasses import replace
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    Provenance,
    registry,
)
from platform_server.apps.modeling.operators.frame import select_rows
from unit.tabular_fakes import run, run_pair, table


@pytest.mark.parametrize(
    ("keep", "indices"),
    [("first", [0, 2, 3]), ("last", [1, 2, 3]), ("none", [2, 3])],
)
def test_deduplicate_preserves_selected_rows_and_timestamps(
    keep: str, indices: list[int]
) -> None:
    source = table()
    result = run("deduplicate", {"columns": ["id", "x"], "keep": keep})
    assert result.rows == tuple(source.rows[seat] for seat in indices)
    assert result.index == tuple(
        (1000, 2000, 3000, 4000)[seat] for seat in indices
    )
    assert result.columns == source.columns
    assert result.provenance == source.provenance


@pytest.mark.parametrize(
    ("direction", "nulls", "moments"),
    [
        ("ascending", "last", (1000, 2000, 4000, 3000)),
        ("descending", "first", (3000, 4000, 1000, 2000)),
    ],
)
def test_sort_is_stable_and_null_placement_is_independent(
    direction: str, nulls: str, moments: tuple[int, ...]
) -> None:
    result = run(
        "sort_rows", {"columns": ["x"], "direction": direction, "nulls": nulls}
    )
    assert result.index == moments
    assert result.provenance == table().provenance


def test_sort_uses_column_priority_and_keeps_time_without_an_index() -> None:
    result = run(
        "sort_rows", {"columns": ["id", "y"]}, replace(table(), index=None)
    )
    assert result.rows == (
        table().rows[0],
        table().rows[1],
        table().rows[2],
        table().rows[3],
    )
    assert result.index is None


@pytest.mark.parametrize(
    ("method", "moments"), [("head", (1000, 2000)), ("stride", (1000, 3000))]
)
def test_sampling_count_never_repeats_and_preserves_order(
    method: str, moments: tuple[int, ...]
) -> None:
    result = run(
        "sample_rows", {"method": method, "size_mode": "count", "count": 2}
    )
    assert result.index == moments
    assert result.columns == table().columns


def test_random_sampling_is_reproducible_and_count_clamps_to_input() -> None:
    config: dict[str, object] = {
        "size_mode": "count",
        "count": 2,
        "random_state": 42,
    }
    first = run("sample_rows", config)
    assert first == run("sample_rows", config)
    assert first.row_count == 2
    assert tuple(sorted(first.index or ())) == first.index
    assert (
        run("sample_rows", {"size_mode": "count", "count": 100}).rows
        == table().rows
    )
    assert run("sample_rows", {"ratio": 0.01}).row_count == 1


@pytest.mark.parametrize("method", ["random", "head", "stride"])
def test_empty_sampling_is_valid(method: str) -> None:
    result = run(
        "sample_rows", {"method": method}, replace(table(), rows=(), index=())
    )
    assert result.rows == result.index == ()


@pytest.mark.parametrize(
    ("agg", "expected"),
    [
        ("sum", 2.0),
        ("avg", 1.0),
        ("min", 1.0),
        ("max", 1.0),
        ("first", 1.0),
        ("last", 1.0),
        ("count", 2.0),
    ],
)
def test_group_aggregate_keeps_null_groups_and_all_null_measure(
    agg: str, expected: float
) -> None:
    result = run(
        "group_aggregate",
        {"group_columns": ["id"], "columns": ["x"], "agg": agg},
    )
    assert result.rows == (
        ("a", expected),
        ("b", 0.0 if agg == "count" else None),
        (None, 1.0 if agg == "count" else 3.0),
    )
    assert result.keys == ("id", f"x_{agg}")
    assert result.columns[1].unit == ("" if agg == "count" else "kWh")
    assert result.index is None
    assert result.provenance == table().provenance


def test_global_grouping_and_empty_input_have_explicit_count_semantics() -> (
    None
):
    result = run("group_aggregate", {"columns": ["x"], "agg": "sum"})
    assert result.rows == ((5.0,),)
    empty = replace(table(), rows=(), index=())
    assert run(
        "group_aggregate", {"columns": ["x"], "agg": "sum"}, empty
    ).rows == ((None,),)
    assert run(
        "group_aggregate", {"columns": ["x"], "agg": "count"}, empty
    ).rows == ((0.0,),)


def test_grouping_rejects_overlap_duplicate_keys_and_group_overflow() -> None:
    with pytest.raises(OperatorError, match="不能同时"):
        run("group_aggregate", {"group_columns": ["x"], "columns": ["x"]})
    with pytest.raises(OperatorError, match="不能重复"):
        run(
            "group_aggregate", {"group_columns": ["id", "id"], "columns": ["x"]}
        )
    with pytest.raises(OperatorError, match="分组数"):
        run("group_aggregate", {"group_columns": ["id"], "max_groups": 1})


def test_key_join_is_many_to_one_and_never_matches_null_keys() -> None:
    source = table()
    right = select_rows(source, [0, 2, 3])
    result = run_pair(
        "key_join", source, right, {"left_key": "id", "right_key": "id"}
    )
    assert result.rows[0][4:] == source.rows[0]
    assert result.rows[1][4:] == source.rows[0]
    assert result.rows[2][4:] == source.rows[2]
    assert result.rows[3][4:] == (None, None, None, None)
    assert result.index == source.index
    assert result.keys == (
        "id",
        "x",
        "y",
        "label",
        "right_id",
        "right_x",
        "right_y",
        "right_label",
    )
    assert result.columns[5].unit == "kWh"
    assert result.provenance == source.provenance


def test_inner_key_join_keeps_only_matching_left_rows() -> None:
    source = table()
    result = run_pair(
        "key_join",
        source,
        select_rows(source, [0]),
        {"left_key": "id", "right_key": "id", "how": "inner"},
    )
    assert result.index == (1000, 2000)
    assert result.row_count == 2


def test_join_rejects_duplicate_right_keys_and_type_mismatch() -> None:
    source = table()
    with pytest.raises(OperatorError, match="重复"):
        run_pair(
            "key_join", source, source, {"left_key": "id", "right_key": "id"}
        )
    with pytest.raises(OperatorError, match="类型不同"):
        run_pair(
            "key_join", source, source, {"left_key": "id", "right_key": "x"}
        )


def test_join_empty_right_is_left_with_nulls_and_inner_is_empty() -> None:
    source = table()
    empty = replace(source, rows=(), index=())
    config: dict[str, object] = {"left_key": "id", "right_key": "id"}
    left = run_pair("key_join", source, empty, config)
    assert all(row[4:] == (None, None, None, None) for row in left.rows)
    assert (
        run_pair("key_join", source, empty, config | {"how": "inner"}).rows
        == ()
    )


def test_concat_projects_by_name_and_keeps_units_time_and_source() -> None:
    left = table()
    right = replace(
        left,
        columns=tuple(reversed(left.columns)),
        rows=tuple(tuple(reversed(row)) for row in left.rows),
        provenance=Provenance(
            table_codes=("other",),
            since=datetime(2025, 1, 1, tzinfo=UTC),
            until=datetime(2026, 2, 1, tzinfo=UTC),
        ),
    )
    result = run_pair("concat_rows", left, right, {})
    assert result.rows == left.rows + left.rows
    assert result.columns == left.columns
    assert result.index == (1000, 2000, 3000, 4000) * 2
    assert result.provenance.table_codes == ("meter", "other")
    assert result.provenance.since == datetime(2025, 1, 1, tzinfo=UTC)
    assert result.provenance.until == datetime(2026, 2, 1, tzinfo=UTC)
    assert result.provenance.is_truncated


def test_concat_union_fills_absent_columns_without_zero() -> None:
    right = Frame(
        columns=(FrameColumn(key="z", name="额外", dtype="number"),),
        rows=((9.0,),),
        index=(5000,),
    )
    result = run_pair("concat_rows", table(), right, {"columns_mode": "union"})
    assert result.keys == ("id", "x", "y", "label", "z")
    assert result.rows[-1] == (None, None, None, None, 9.0)
    assert result.rows[0] == ("a", 1.0, 2.0, " A ", None)


def test_concat_rejects_ambiguous_columns_types_units_and_index() -> None:
    source = table()
    with pytest.raises(OperatorError, match="列名集合"):
        run_pair(
            "concat_rows",
            source,
            replace(
                source,
                columns=source.columns[:1],
                rows=tuple(row[:1] for row in source.rows),
            ),
            {},
        )
    changed = replace(
        source,
        columns=tuple(
            replace(column, unit="kW") if column.key == "x" else column
            for column in source.columns
        ),
    )
    with pytest.raises(OperatorError, match="单位不一致"):
        run_pair("concat_rows", source, changed, {})
    with pytest.raises(OperatorError, match="都有时间"):
        run_pair("concat_rows", source, replace(source, index=None), {})
    with pytest.raises(OperatorError, match="索引名称"):
        run_pair("concat_rows", source, replace(source, index_name="other"), {})


def test_tabular_capacity_rejects_input_concat_and_join_before_expansion() -> (
    None
):
    source = table()
    huge = replace(source, rows=(source.rows[0],) * 200_001, index=None)
    with pytest.raises(OperatorError, match="200000"):
        run("deduplicate", {}, huge)
    half = replace(source, rows=(source.rows[0],) * 100_001, index=None)
    with pytest.raises(OperatorError, match="200000"):
        run_pair("concat_rows", half, half, {})
    wide = Frame(
        columns=tuple(
            FrameColumn(key=f"c{seat}", name=f"c{seat}", dtype="number")
            for seat in range(129)
        ),
        rows=(tuple(float(seat) for seat in range(129)),),
    )
    with pytest.raises(OperatorError, match="256"):
        run_pair("key_join", wide, wide, {"left_key": "c0", "right_key": "c0"})


@pytest.mark.parametrize(
    "config", [{"ratio": 0}, {"count": 200_001}, {"random_state": -1}]
)
def test_sample_schema_rejects_invalid_capacity(
    config: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        registry.build("sample_rows", config)


def test_column_selection_rejects_unknown_duplicate_and_nonnumeric_keys() -> (
    None
):
    with pytest.raises(OperatorError, match="没有列"):
        run("sort_rows", {"columns": ["missing"]})
    with pytest.raises(OperatorError, match="不能重复"):
        run("deduplicate", {"columns": ["id", "id"]})
    with pytest.raises(OperatorError, match="不是数值"):
        run("group_aggregate", {"columns": ["id"]})


def test_join_and_aggregation_reject_ambiguous_output_names() -> None:
    source = table()
    left = replace(
        source,
        columns=(
            *source.columns,
            FrameColumn(key="r_id", name="已有列", dtype="string"),
        ),
        rows=tuple((*row, "existing") for row in source.rows),
    )
    with pytest.raises(OperatorError, match="前缀"):
        run_pair(
            "key_join",
            left,
            select_rows(source, [0]),
            {"left_key": "id", "right_key": "id", "right_prefix": "r_"},
        )
    grouped = Frame(
        columns=(
            FrameColumn(key="x_sum", name="分组", dtype="string"),
            FrameColumn(key="x", name="度量", dtype="number"),
        ),
        rows=(("a", 1.0),),
    )
    with pytest.raises(OperatorError, match="输出列名"):
        run(
            "group_aggregate",
            {"group_columns": ["x_sum"], "columns": ["x"]},
            grouped,
        )


def test_aggregation_overflow_is_a_domain_error() -> None:
    source = Frame(
        columns=(FrameColumn(key="x", name="值", dtype="number"),),
        rows=((1e308,), (1e308,)),
    )
    with pytest.raises(OperatorError, match="数值范围"):
        run("group_aggregate", {"columns": ["x"], "agg": "sum"}, source)
