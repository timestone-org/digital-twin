"""图表节点折算：时间、分类与字段三种横轴共用一份类目与对齐取值。

Word 原生图表、位图后备与编辑器正文都只读这份产物，横轴文字由服务端格式化，
三处才能逐字一致，见 docs/REPORT_TEMPLATE_DESIGN.md「编辑与成品一致」。
"""

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import ColumnSpec
from platform_server.apps.report.schemas.document import MetricDef
from platform_server.apps.report.schemas.nodes import DataNodeSpec, SeriesSpec
from platform_server.apps.report.schemas.preview import (
    ChartSeries,
    NodeValue,
    SeriesPoint,
)
from platform_server.apps.report.services.aggregation import (
    aggregate,
    format_value,
    wire_value,
)
from platform_server.apps.report.services.metrics import (
    MAX_OUTPUT_VALUES,
    PreviewContext,
    metric_window,
)
from platform_server.apps.report.services.source import SourceData
from platform_server.apps.report.services.table import bucket_start

EMPTY_CATEGORY = "（空）"
_TIME_FORMATS = {
    "datetime": "%Y-%m-%d %H:%M",
    "date": "%Y-%m-%d",
    "time": "%H:%M",
    "month": "%Y-%m",
}
_AUTO_FORMATS = {
    "none": "%m-%d %H:%M",
    "hour": "%m-%d %H:00",
    "day": "%m-%d",
    "month": "%Y-%m",
}


@dataclass(frozen=True)
class LoadedSeries:
    """一条序列的配置与它读到的数据。"""

    spec: SeriesSpec
    found: SourceData
    column: ColumnSpec


@dataclass(frozen=True)
class ChartFrame:
    """对齐后的类目与各序列取值。"""

    categories: list[str]
    series: list[tuple[str, list[object]]]
    stamps: list[datetime]
    is_truncated: bool


async def chart_node(
    session: AsyncSession, context: PreviewContext, spec: DataNodeSpec
) -> NodeValue:
    """读取全部序列并按横轴模式折算。Args: session, context, spec。"""
    if not spec.series:
        raise ValueError("图表尚未配置数据序列")
    loaded = [
        await _load_series(session, context, spec, item) for item in spec.series
    ]
    width = 1 if spec.kind == "pie" else len(loaded)
    remaining = (MAX_OUTPUT_VALUES - context.output_values) // max(1, width)
    if remaining < 1:
        raise ValueError("报告展示数据总量达到上限")
    bounded = spec.model_copy(update={"limit": min(spec.limit, remaining)})
    frame = _frame(loaded, bounded, context.timezone)
    if spec.kind == "pie":
        frame = ChartFrame(
            frame.categories, frame.series[:1], frame.stamps, frame.is_truncated
        )
    context.output_values += len(frame.categories) * len(frame.series)
    return NodeValue(
        kind=spec.kind,
        title=spec.title,
        x_axis=spec.x_axis,
        categories=frame.categories,
        series=[_series(name, values, frame) for name, values in frame.series],
        is_truncated=frame.is_truncated
        or any(item.found.is_truncated for item in loaded),
        is_stale=any(item.found.is_stale for item in loaded),
    )


async def _load_series(
    session: AsyncSession,
    context: PreviewContext,
    spec: DataNodeSpec,
    item: SeriesSpec,
) -> LoadedSeries:
    metric = MetricDef(
        name="图表",
        table=item.table,
        key=item.key,
        window=spec.window,
        offset=spec.offset + item.offset,
        anchor=spec.anchor,
    )
    found = await context.read(
        session, await metric_window(session, context, metric)
    )
    column = next(
        (column for column in found.columns if column.key == item.key), None
    )
    if column is None:
        raise ValueError("图表引用的数据字段不存在")
    if column.data_type != "number":
        raise ValueError("图表只能选择数字类型的数据字段")
    return LoadedSeries(spec=item, found=found, column=column)


def _frame(
    loaded: list[LoadedSeries], spec: DataNodeSpec, timezone: str
) -> ChartFrame:
    if spec.x_axis == "field":
        return _field_frame(loaded, spec)
    if spec.x_axis == "category":
        return _category_frame(loaded, spec)
    return _time_frame(loaded, spec, timezone)


def _series_name(item: LoadedSeries) -> str:
    return item.spec.name or item.column.name or item.spec.key


def _field_frame(loaded: list[LoadedSeries], spec: DataNodeSpec) -> ChartFrame:
    """每个字段是一个类目，适合列表型接口与多指标对比。Args: loaded, spec。"""
    kept = loaded[: spec.limit]
    values = [
        aggregate(
            [row.values.get(item.spec.key) for row in item.found.rows], spec.agg
        )
        for item in kept
    ]
    return ChartFrame(
        categories=[_series_name(item) for item in kept],
        series=[(spec.title or "数值", values)],
        stamps=[],
        is_truncated=len(loaded) > spec.limit,
    )


def _category_frame(
    loaded: list[LoadedSeries], spec: DataNodeSpec
) -> ChartFrame:
    """按分类字段归并行，类目保持首次出现的顺序。Args: loaded, spec。"""
    found = loaded[0].found
    kinds = {column.key: column.data_type for column in found.columns}
    if spec.category_key not in kinds:
        raise ValueError("分类字段不存在，请重新选择横轴分类")
    groups: dict[str, list[dict[str, object]]] = {}
    for row in found.rows:
        raw = row.values.get(spec.category_key)
        label = (
            format_value(raw, kinds[spec.category_key], precision=None)
            if raw is not None
            else EMPTY_CATEGORY
        ) or EMPTY_CATEGORY
        groups.setdefault(label, []).append(dict(row.values))
    labels = list(groups)
    if spec.order == "desc":
        labels.reverse()
    kept = labels[: spec.limit]
    return ChartFrame(
        categories=kept,
        series=[
            (
                _series_name(item),
                [
                    aggregate(
                        [values.get(item.spec.key) for values in groups[label]],
                        spec.agg,
                    )
                    for label in kept
                ],
            )
            for item in loaded
        ],
        stamps=[],
        is_truncated=len(labels) > spec.limit,
    )


def _time_frame(
    loaded: list[LoadedSeries], spec: DataNodeSpec, timezone: str
) -> ChartFrame:
    """各序列按时刻并集对齐，保留最新时刻。Args: loaded, spec, timezone。"""
    zone = ZoneInfo(timezone)
    by_series = [_time_values(item, spec, zone) for item in loaded]
    domain = sorted({stamp for values in by_series for stamp in values})
    kept = domain[-spec.limit :]
    if spec.order == "desc":
        kept.reverse()
    return ChartFrame(
        categories=[chart_time_label(stamp, spec, zone) for stamp in kept],
        series=[
            (_series_name(item), [values.get(stamp) for stamp in kept])
            for item, values in zip(loaded, by_series, strict=True)
        ],
        stamps=kept,
        is_truncated=len(domain) > spec.limit,
    )


def _time_values(
    item: LoadedSeries, spec: DataNodeSpec, zone: ZoneInfo
) -> dict[datetime, object]:
    if spec.bucket == "none":
        return {
            row.ts: row.values.get(item.spec.key) for row in item.found.rows
        }
    grouped: dict[datetime, list[object]] = {}
    for row in item.found.rows:
        stamp = bucket_start(row.ts.astimezone(zone), spec.bucket)
        grouped.setdefault(stamp, []).append(row.values.get(item.spec.key))
    return {
        stamp: aggregate(values, spec.agg) for stamp, values in grouped.items()
    }


def chart_time_label(
    stamp: datetime, spec: DataNodeSpec, zone: ZoneInfo
) -> str:
    """横轴时刻文字，按业务时区与时间格式。Args: stamp, spec, zone。"""
    pattern = (
        _AUTO_FORMATS[spec.bucket]
        if spec.time_format == "auto"
        else _TIME_FORMATS[spec.time_format]
    )
    return stamp.astimezone(zone).strftime(pattern)


def _series(name: str, values: list[object], frame: ChartFrame) -> ChartSeries:
    numbers = [_chart_number(value) for value in values]
    return ChartSeries(
        name=name,
        values=numbers,
        points=[
            SeriesPoint(ts=stamp, value=number)
            for stamp, number in zip(frame.stamps, numbers, strict=False)
        ],
    )


def _chart_number(value: object) -> str | None:
    resolved = wire_value(value)
    if isinstance(resolved, bool):
        return str(int(resolved))
    return resolved if isinstance(resolved, str) or resolved is None else None
