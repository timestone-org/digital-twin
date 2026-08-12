"""空调原始数据的读取面：可绑定对象发现、表格翻页与聚合序列。

区间上限、游标口径与桶档位见 docs/AC_DATA_DESIGN.md §5.2、§5.5、§5.6。
"""

import math
import uuid
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import ValidationFailed
from lib.utils.timeutils import format_rfc3339
from lib.web import CursorPage, CursorParams, decode_cursor, encode_cursor
from platform_server.apps.hvac.datasets import (
    DATASET_RAW_MINUTE,
    SOURCE_TIME_COLUMN,
    metric_keys,
)
from platform_server.apps.hvac.errors import (
    CursorInvalid,
    MetricUnknown,
    TimeRangeInvalid,
)
from platform_server.apps.hvac.schemas import (
    RawSampleOut,
    RawSeriesOut,
    SeriesOptions,
    SeriesPointOut,
    SourceObjectOut,
    SourceObjectsOut,
    TimeWindow,
)
from platform_server.apps.hvac.services.ac_data_service import (
    require_binding,
    require_dataset,
)
from platform_server.apps.hvac.services.ac_source_reader import (
    AcSourceReader,
    SourceRow,
)

# 表格一次最多看一个月，折线图一次最多看一年——不给一个能拉全表的入口
MAX_SAMPLES_SPAN = timedelta(days=31)
MAX_SERIES_SPAN = timedelta(days=366)
# 折线图的桶档位，向上取到最近的一档
BUCKET_MINUTES = (1, 5, 10, 15, 30, 60, 120, 360, 720, 1440)
# 一次最多画几条线：再多前端也读不出来，而每条线都是一列聚合
MAX_SERIES_METRICS = 8
# 游标里锚点的字段名
CURSOR_TIME_FIELD = "ts"
# ⚠ 锚点比上一页最后一行晚 1 秒：外库时间精度到分钟，加 1 秒即可严格前进
# 且不会漏行；也正因为时刻无重复，游标不需要额外的去重序号
CURSOR_STEP = timedelta(seconds=1)


async def list_source_objects(
    reader: AcSourceReader, *, dataset: str
) -> SourceObjectsOut:
    """外库里列形状符合该数据集的全部对象。

    Args: reader, dataset。
    """
    spec = require_dataset(dataset)
    required = (SOURCE_TIME_COLUMN, *metric_keys(spec))
    names = await reader.list_bindable_objects(required)
    captions = await reader.list_captions()
    return SourceObjectsOut(
        items=[
            SourceObjectOut(
                name=name,
                caption=caption_for(name, captions),
                # ⚠ 恒为 null：可绑定的都是视图，SQL Server 不为视图存行数
                # 统计，真去数一次就是一次 190 万行的全扫描
                row_count_hint=None,
            )
            for name in names
        ]
    )


def caption_for(name: str, captions: Mapping[str, str]) -> str | None:
    """按对象名末段的设备号取厂商台账里的名字，对不上给 None。

    Args: name, captions。
    """
    return captions.get(name.rsplit("_", maxsplit=1)[-1])


async def list_raw_samples(
    session: AsyncSession,
    reader: AcSourceReader,
    *,
    ac_unit_id: uuid.UUID,
    window: TimeWindow,
    cursor: CursorParams,
) -> CursorPage[RawSampleOut]:
    """一台空调的原始数据表格，游标翻页。

    Args: session, reader, ac_unit_id, window, cursor。
    """
    binding = await require_binding(
        session, ac_unit_id=ac_unit_id, dataset=DATASET_RAW_MINUTE
    )
    ensure_window(window, max_span=MAX_SAMPLES_SPAN)
    columns = metric_keys(require_dataset(DATASET_RAW_MINUTE))
    rows = await reader.fetch_samples(
        source_object=binding.source_object,
        columns=columns,
        window=TimeWindow(
            start=anchor_of(cursor.after, window), end=window.end
        ),
        # 多取一行判断还有没有下一页，省掉一次 count
        row_limit=cursor.limit + 1,
    )
    return to_cursor_page(rows, limit=cursor.limit, columns=columns)


async def list_raw_series(
    session: AsyncSession,
    reader: AcSourceReader,
    *,
    ac_unit_id: uuid.UUID,
    window: TimeWindow,
    options: SeriesOptions,
) -> RawSeriesOut:
    """一台空调的聚合序列，桶宽由服务端按点数上限挑并回显。

    Args: session, reader, ac_unit_id, window, options。
    """
    binding = await require_binding(
        session, ac_unit_id=ac_unit_id, dataset=DATASET_RAW_MINUTE
    )
    ensure_window(window, max_span=MAX_SERIES_SPAN)
    metrics = validated_metrics(options.metrics)
    bucket_minutes = choose_bucket_minutes(
        window.end - window.start, options.max_points
    )
    rows = await reader.fetch_buckets(
        source_object=binding.source_object,
        columns=metrics,
        window=window,
        bucket_minutes=bucket_minutes,
    )
    return RawSeriesOut(
        interval_minutes=bucket_minutes,
        metrics=list(metrics),
        points=[
            SeriesPointOut.model_validate({"ts": row.ts, "values": row.values})
            for row in rows
        ],
    )


def ensure_window(window: TimeWindow, *, max_span: timedelta) -> None:
    """区间必须带时区、左闭右开且不超上限。

    ⚠ naive 时间一律拒绝：把它当成 UTC 还是当成服务器本地时都只是猜，而猜错
    的表现是「同一个请求在不同机器上取到不同的数据」，两边都不报错。
    Args: window, max_span。
    """
    if window.start.tzinfo is None or window.end.tzinfo is None:
        raise TimeRangeInvalid("时间必须带时区，形如 2026-08-12T00:00:00Z")
    if window.start >= window.end:
        raise TimeRangeInvalid("区间左端必须早于右端")
    if window.end - window.start > max_span:
        raise TimeRangeInvalid(f"区间不得超过 {max_span.days} 天")


def choose_bucket_minutes(span: timedelta, max_points: int) -> int:
    """按点数上限挑一个桶档位，向上取到最近的一档。

    Args: span, max_points。
    """
    wanted = math.ceil(span.total_seconds() / 60 / max_points)
    for minutes in BUCKET_MINUTES:
        if minutes >= wanted:
            return minutes
    return BUCKET_MINUTES[-1]


def validated_metrics(raw: str) -> tuple[str, ...]:
    """把逗号分隔的指标串校验成目录内的 key 元组，保持请求顺序。

    Args: raw。
    """
    allowed = set(metric_keys(require_dataset(DATASET_RAW_MINUTE)))
    wanted = tuple(
        dict.fromkeys(item.strip() for item in raw.split(",") if item.strip())
    )
    unknown = [key for key in wanted if key not in allowed]
    if unknown:
        raise MetricUnknown(f"指标不在目录内：{'、'.join(sorted(unknown))}")
    if not wanted:
        raise MetricUnknown("至少要选一个指标")
    if len(wanted) > MAX_SERIES_METRICS:
        raise MetricUnknown(f"一次最多看 {MAX_SERIES_METRICS} 个指标")
    return wanted


def anchor_of(after: str | None, window: TimeWindow) -> datetime:
    """首页从区间左端起算，翻页从上一页最后一行之后起算。

    Args: after, window。
    """
    if after is None:
        return window.start
    return decode_anchor(after) + CURSOR_STEP


def decode_anchor(raw: str) -> datetime:
    """把游标解回锚点时刻；任何畸形输入都按游标不可解析拒绝。

    Args: raw。
    """
    try:
        payload = decode_cursor(raw)
    except ValidationFailed as error:
        raise _cursor_rejected() from error
    moment = payload.get(CURSOR_TIME_FIELD)
    if moment is None:
        raise _cursor_rejected()
    try:
        parsed = datetime.fromisoformat(moment)
    except ValueError as error:
        raise _cursor_rejected() from error
    if parsed.tzinfo is None:
        raise _cursor_rejected()
    return parsed


def to_cursor_page(
    rows: Sequence[SourceRow], *, limit: int, columns: Sequence[str]
) -> CursorPage[RawSampleOut]:
    """把取回的行切成一页，多出来的那一行只用于判断还有没有下一页。

    Args: rows, limit, columns。
    """
    has_more = len(rows) > limit
    visible = list(rows[:limit])
    next_cursor = (
        encode_cursor({CURSOR_TIME_FIELD: format_rfc3339(visible[-1].ts)})
        if has_more and visible
        else None
    )
    return CursorPage[RawSampleOut](
        items=[to_sample(row, columns) for row in visible],
        next=next_cursor,
        has_more=has_more,
    )


def to_sample(row: SourceRow, columns: Sequence[str]) -> RawSampleOut:
    """一行外库数据 → 一行表格。NULL 原样保持 null，不折成 0。

    Args: row, columns。
    """
    payload: dict[str, object] = {"ts": row.ts}
    payload.update({name: row.values.get(name) for name in columns})
    return RawSampleOut.model_validate(payload)


def _cursor_rejected() -> CursorInvalid:
    return CursorInvalid("游标不可解析，请从上一页响应里原样带回")
