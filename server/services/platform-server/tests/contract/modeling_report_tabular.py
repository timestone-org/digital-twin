"""通用表格算子的全目录最小输入。"""

from dataclasses import replace
from typing import Any

from platform_server.apps.modeling.operators import Frame


def tabular_cases(
    source: Frame,
) -> dict[str, tuple[dict[str, Any], dict[str, Any]]]:
    """为每个通用表格算子提供真实可执行的输入。Args: source。"""
    one: dict[str, Any] = {"frame": source}
    pair: dict[str, Any] = {"left": source, "right": source}
    lookup = replace(
        source,
        rows=source.rows[:1],
        index=None if source.index is None else source.index[:1],
    )
    return {
        "binning": (one, {"columns": ["温度"]}),
        "column_math": (one, {"left_column": "温度"}),
        "concat_rows": (pair, {}),
        "correlation": (one, {"columns": ["温度", "负荷"]}),
        "cumulative_stats": (one, {"columns": ["温度"]}),
        "deduplicate": (one, {}),
        "describe_stats": (one, {}),
        "difference": (one, {"columns": ["温度"]}),
        "group_aggregate": (
            one,
            {"group_columns": ["班次"], "columns": ["温度"]},
        ),
        "key_join": (
            {"left": source, "right": lookup},
            {"left_key": "温度", "right_key": "温度"},
        ),
        "numeric_transform": (one, {}),
        "rank_rows": (one, {"column": "温度"}),
        "replace_values": (one, {}),
        "sample_rows": (one, {}),
        "sort_rows": (one, {}),
        "text_transform": (one, {}),
    }


def lookup_frame(source: Frame) -> Frame:
    """保留首列每个非空键的第一行，构造宽关联输入。Args: source。"""
    seen: set[object] = set()
    seats: list[int] = []
    for seat, row in enumerate(source.rows):
        value = row[0]
        if value is not None and value not in seen:
            seen.add(value)
            seats.append(seat)
    return replace(
        source,
        rows=tuple(source.rows[seat] for seat in seats),
        index=(
            None
            if source.index is None
            else tuple(source.index[seat] for seat in seats)
        ),
    )


def tabular_loads(
    pool: dict[str, Frame],
) -> dict[str, tuple[tuple[dict[str, Any], dict[str, Any]], ...]]:
    """让表格算子处理共用宽帧、长轴与文本列。Args: pool。"""
    wide = pool["wide"]
    one: dict[str, Any] = {"frame": wide}
    keys = list(wide.keys)
    return {
        "binning": (
            (
                one,
                {
                    "columns": keys,
                    "boundaries": [float(seat) for seat in range(100)],
                },
            ),
        ),
        "column_math": ((one, {"left_column": keys[0]}),),
        "concat_rows": (({"left": wide, "right": wide}, {}),),
        "correlation": ((one, {"columns": keys[:32]}),),
        "cumulative_stats": ((one, {"columns": keys}),),
        "deduplicate": ((one, {}),),
        "describe_stats": ((one, {}),),
        "difference": ((one, {"columns": keys}),),
        "group_aggregate": (
            (one, {"group_columns": keys[:1], "columns": keys[1:]}),
        ),
        "key_join": (
            (
                {"left": wide, "right": pool["tabular_lookup"]},
                {"left_key": keys[0], "right_key": keys[0]},
            ),
        ),
        "numeric_transform": ((one, {}),),
        "rank_rows": ((one, {"column": keys[0]}),),
        "replace_values": ((one, {}),),
        "sample_rows": ((one, {}),),
        "sort_rows": ((one, {}),),
        "text_transform": (({"frame": pool["categorical"]}, {}),),
    }
