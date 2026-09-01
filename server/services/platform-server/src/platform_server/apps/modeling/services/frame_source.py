"""台账 → 特征帧：本模块**唯一**的跨模块取数处。

⚠ 取值口径不自己拼：人工修正优先、公式结果覆盖同名键这一份实现只在台账那边有
一份，自己拼一份的现象是「模型训练用的是原值、界面上看的是修正值」，两边各自
自洽，排查时几乎不会怀疑到取值口径上（docs/MODELING_DESIGN.md §3.3）。
"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError, ValidationFailed
from platform_server.apps.dataset.services import (
    ColumnSpec,
    EffectiveRow,
    EffectiveWindow,
    column_service,
    record_read,
    table_service,
)
from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    Provenance,
    registry,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph

# 相对时刻的写法：`-90d` / `-12h` / `-30m` / `-4w`
_RELATIVE = re.compile(r"^-(\d{1,6})([mhdw])$")
_UNITS = {
    "m": timedelta(minutes=1),
    "h": timedelta(hours=1),
    "d": timedelta(days=1),
    "w": timedelta(weeks=1),
}
# 行来源参数里的「全都要」。⚠ 它落到台账那边是空元组而不是四种都列上
ROW_SOURCE_ALL = "all"

# 台账的列类型 → 帧的列类型。两边同名，映射写出来是为了改一边时另一边会红
_DTYPES = {"number": "number", "bool": "bool", "string": "string"}


@dataclass(frozen=True)
class SourceRequest:
    """一次取数要的全部参数，取自取数节点的配置。"""

    table_code: str
    columns: tuple[str, ...]
    since: str
    until: str
    row_source: str
    row_limit: int


async def load_frame(
    session: AsyncSession, *, request: SourceRequest, now: datetime
) -> Frame:
    """按一份取数请求造出特征帧。

    ⚠ `is_truncated` 一路如实往上传：触顶而不说的话，用户会拿一段被截过的数据
    当成整段来解释模型。
    Args: session, request, now。
    """
    table_id = await table_service.resolve_table_code(
        session, request.table_code
    )
    specs = await column_service.list_column_specs(session, table_id=table_id)
    columns = _selected(specs, request.columns)
    since = _moment(request.since, now, "since")
    until = _moment(request.until, now, "until") or now
    scan = await record_read.scan_effective(
        session,
        window=EffectiveWindow(
            table_id=table_id,
            since=since,
            until=until,
            sources=_sources(request.row_source),
        ),
        limit=request.row_limit,
    )
    window = _Window(since=since, until=until, is_truncated=scan.is_truncated)
    return _build(columns, scan.rows, request, window)


@dataclass(frozen=True)
class _Window:
    """这一次实际取到的那一段，连同触顶与否。"""

    since: datetime | None
    until: datetime
    is_truncated: bool


def _build(
    columns: tuple[ColumnSpec, ...],
    rows: tuple[EffectiveRow, ...],
    request: SourceRequest,
    window: _Window,
) -> Frame:
    """把取到的行折成等宽矩阵，并统计每列转不动的格数。

    Args: columns, rows, request, window。
    """
    failures = [0] * len(columns)
    matrix: list[tuple[CellValue, ...]] = []
    for row in rows:
        cells: list[CellValue] = []
        for position, column in enumerate(columns):
            value, is_bad = _coerce(row.values.get(column.key), column)
            failures[position] += int(is_bad)
            cells.append(value)
        matrix.append(tuple(cells))
    return Frame(
        columns=tuple(
            FrameColumn(
                key=column.key,
                name=column.name,
                dtype=_DTYPES.get(column.data_type, "string"),
                unit=column.unit,
                coerce_failed=failures[position],
            )
            for position, column in enumerate(columns)
        ),
        rows=tuple(matrix),
        index=tuple(int(row.ts.timestamp() * 1000) for row in rows),
        provenance=Provenance(
            table_codes=(request.table_code,),
            since=window.since,
            until=window.until,
            is_truncated=window.is_truncated,
        ),
    )


def _selected(
    specs: tuple[ColumnSpec, ...], wanted: tuple[str, ...]
) -> tuple[ColumnSpec, ...]:
    """按配置挑列；留空取当前全部列，指定了不存在的列即 400。

    Args: specs, wanted。
    """
    if not wanted:
        return specs
    known = {spec.key: spec for spec in specs}
    missing = [key for key in wanted if key not in known]
    if missing:
        raise ValidationFailed(
            "取数配置里的列在台账上不存在",
            details=tuple(
                FieldError(
                    field="columns",
                    code="unknown_column",
                    message=f"没有列「{key}」",
                )
                for key in missing
            ),
        )
    return tuple(known[key] for key in wanted)


def _sources(row_source: str) -> tuple[str, ...]:
    """行来源参数落到台账那边的形态。

    Args: row_source。
    """
    return () if row_source == ROW_SOURCE_ALL else (row_source,)


def _coerce(value: object, column: ColumnSpec) -> tuple[CellValue, bool]:
    """按列定义的类型转一个格；转不动就当缺失并记一笔。

    ⚠ 转不动**不能**当 0：那会把「没测到」变成「测到 0」，而模型学得津津有味。
    Args: value, column。
    """
    if value is None:
        return None, False
    if column.data_type == "number":
        return _as_number(value)
    if column.data_type == "bool":
        return (bool(value), False)
    return (str(value), False)


def _as_number(value: object) -> tuple[CellValue, bool]:
    if isinstance(value, bool):
        return float(value), False
    if isinstance(value, (int, float)):
        return float(value), False
    try:
        return float(str(value)), False
    except ValueError:
        return None, True


def _moment(raw: str, now: datetime, field: str) -> datetime | None:
    """把一个时刻参数解析成 UTC 时刻。空串表示不限。

    Args: raw, now, field。
    """
    text = raw.strip()
    if not text:
        return None
    relative = _RELATIVE.match(text)
    if relative is not None:
        return now - _UNITS[relative.group(2)] * int(relative.group(1))
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise ValidationFailed(
            "时刻写法不认识",
            details=(
                FieldError(
                    field=field,
                    code="bad_moment",
                    message="要么是完整时刻，要么是 -90d / -12h 这类相对写法",
                ),
            ),
        ) from None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


async def prefetch(
    session: AsyncSession, *, graph: PipelineGraph, now: datetime
) -> dict[str, Frame]:
    """给图里每个取数节点先把数据取好，按节点 id 交给执行引擎。

    ⚠ 取数不在算子里跑：算子将来要整体挪进没有数据库连接的子进程
    （docs/MODELING_DESIGN.md D17b）。
    Args: session, graph, now。
    """
    frames: dict[str, Frame] = {}
    for node in graph.nodes:
        loader = _LOADERS.get(node.operator)
        if loader is None:
            continue
        config = registry.get(node.operator).CONFIG_MODEL.model_validate(
            node.config
        )
        frames[node.id] = await loader(session, config.model_dump(), now)
    return frames


async def _load_ledger(
    session: AsyncSession, config: dict[str, object], now: datetime
) -> Frame:
    """`ledger_source` 的加载器。

    Args: session, config, now。
    """
    return await load_frame(
        session,
        request=SourceRequest(
            table_code=str(config["table_code"]),
            columns=_str_tuple(config["columns"]),
            since=str(config["since"]),
            until=str(config["until"]),
            row_source=str(config["row_source"]),
            row_limit=int(str(config["row_limit"])),
        ),
        now=now,
    )


# 哪个取数算子由哪份加载器负责。⚠ 显式登记：加取数算子时在这里加一行，
# 不做「按分类猜」——不同的取数算子参数形状不同，猜不出来
_LOADERS = {"ledger_source": _load_ledger}


def _str_tuple(raw: object) -> tuple[str, ...]:
    """把一个来自参数的列表还原成字符串元组。

    Args: raw。
    """
    if not isinstance(raw, list):
        return ()
    return tuple(str(item) for item in cast("list[object]", raw))
