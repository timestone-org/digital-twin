"""台账表格归并、排序、截断与汇总。"""

from datetime import datetime
from zoneinfo import ZoneInfo

from platform_server.apps.report.schemas.nodes import DataNodeSpec
from platform_server.apps.report.schemas.preview import NodeValue
from platform_server.apps.report.services.aggregation import (
    aggregate,
    format_number,
)
from platform_server.apps.report.services.source import SourceData


def build_table(
    found: SourceData, spec: DataNodeSpec, timezone: str
) -> NodeValue:
    """构造报告里的表格，汇总只算可见行。Args: found, spec, timezone。"""
    columns = {column.key: column.name for column in found.columns}
    if not spec.keys or set(spec.keys) - columns.keys():
        raise ValueError("表格必须选择存在的台账列")
    values = _values(found, spec, timezone)
    is_truncated = found.is_truncated or len(values) > spec.limit
    values = values[-spec.limit :]
    if spec.order == "desc":
        values.reverse()
    rows = [
        [
            _time_label(stamp, spec),
            *(format_number(value, spec.decimals) for value in row),
        ]
        for stamp, row in values
    ]
    if spec.summary != "none" and values:
        rows.append(_summary(values, spec))
    return NodeValue(
        kind="dsTable",
        title=spec.title,
        columns=["时间", *(columns[key] for key in spec.keys)],
        rows=rows,
        is_truncated=is_truncated,
        is_stale=found.is_stale,
    )


def _values(
    found: SourceData, spec: DataNodeSpec, timezone: str
) -> list[tuple[datetime, list[object]]]:
    if spec.bucket == "none":
        zone = ZoneInfo(timezone)
        return [
            (
                row.ts.astimezone(zone),
                [row.values.get(key) for key in spec.keys],
            )
            for row in found.rows
        ]
    return [
        (stamp, [aggregate(group[key], spec.agg) for key in spec.keys])
        for stamp, group in sorted(_groups(found, spec, timezone).items())
    ]


def _summary(
    values: list[tuple[datetime, list[object]]], spec: DataNodeSpec
) -> list[str]:
    if spec.summary == "none":
        return []
    labels = {
        "avg": "均值",
        "sum": "合计",
        "min": "最小值",
        "max": "最大值",
        "count": "计数",
    }
    return [
        labels[spec.summary],
        *(
            format_number(
                aggregate([row[index] for _, row in values], spec.summary),
                spec.decimals,
            )
            for index in range(len(spec.keys))
        ),
    ]


def _groups(
    found: SourceData, spec: DataNodeSpec, timezone: str
) -> dict[datetime, dict[str, list[object]]]:
    grouped: dict[datetime, dict[str, list[object]]] = {}
    for row in found.rows:
        stamp = _bucket(row.ts.astimezone(ZoneInfo(timezone)), spec.bucket)
        if stamp not in grouped:
            grouped[stamp] = {key: [] for key in spec.keys}
        for key in spec.keys:
            grouped[stamp][key].append(row.values.get(key))
    return grouped


def _bucket(stamp: datetime, bucket: str) -> datetime:
    if bucket == "none":
        return stamp
    stamp = stamp.replace(minute=0, second=0, microsecond=0)
    if bucket == "hour":
        return stamp
    stamp = stamp.replace(hour=0)
    return stamp.replace(day=1) if bucket == "month" else stamp


def _time_label(stamp: datetime, spec: DataNodeSpec) -> str:
    formats = {
        "datetime": "%Y-%m-%d %H:%M",
        "date": "%Y-%m-%d",
        "time": "%H:%M",
        "month": "%Y-%m",
    }
    selected = spec.time_format
    if selected == "auto":
        selected = "month" if spec.bucket == "month" else "datetime"
    return stamp.strftime(formats[selected])
