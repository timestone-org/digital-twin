"""在数据库事务外读取 BDM 序列，并按时间构造特征帧。"""

from __future__ import annotations

import asyncio
import math
from concurrent.futures.process import BrokenProcessPool
from dataclasses import dataclass, field
from datetime import datetime
from functools import partial
from types import MappingProxyType
from typing import TYPE_CHECKING

from pydantic import JsonValue

from lib.errors import AppError
from platform_server.apps.modeling.operators.bdm import BdmSourceConfig
from platform_server.apps.modeling.operators.frame import (
    CellValue,
    Frame,
    FrameColumn,
    Provenance,
)
from platform_server.apps.modeling.schemas.bdm import BdmSeries, BdmSeriesData
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.bdm_client import (
    BdmClient,
    BdmConnection,
    BdmReadFailed,
)
from platform_server.apps.modeling.services.bdm_window import (
    BdmWindow,
    formula_windows,
    history_windows,
    is_interval_aligned,
    resolve_window,
    sample_time,
)
from platform_server.apps.modeling.services.frame_source import Prefetched

if TYPE_CHECKING:
    from platform_server.apps.modeling.services.run_pool import NodePool

MAX_REQUESTS = 1000
MAX_OFFSET = 100_000
PAGE_SIZE = 500
QUERY_PATHS = MappingProxyType(
    {
        "point": "/points/query",
        "raw": "/raw/query",
        "formula": "/formula/query",
    }
)
ID_FIELDS = MappingProxyType(
    {"point": "pointIds", "raw": "propertyIds", "formula": "codes"}
)


@dataclass
class _Read:
    identifier: str
    name: str = ""
    unit: str = ""
    is_truncated: bool = False
    samples: dict[int, CellValue] = field(default_factory=dict[int, CellValue])


@dataclass
class _RequestBudget:
    count: int = 0

    def take(self) -> None:
        self.count += 1
        if self.count > MAX_REQUESTS:
            raise BdmReadFailed("BDM 取数超过请求次数上限，请缩小时间范围")


async def load_frame(
    client: BdmClient, config: BdmSourceConfig, *, now: datetime, pool: NodePool
) -> Frame:
    """按标识逐个分页，返回带截断标记的帧。

    Args: client, config, now, pool。
    """
    window = resolve_window(config, now, client.connection.timezone)
    budget = _RequestBudget()
    try:
        async with asyncio.timeout(client.connection.load_timeout_s):
            reads = [
                await _read_identifier(
                    client, config, window, identifier, budget
                )
                for identifier in config.identifiers
            ]
            return await pool.run(
                partial(_build_frame, reads, config, window, now)
            )
    except TimeoutError:
        raise BdmReadFailed("BDM 取数超过总时限，请缩小时间范围") from None
    except BrokenProcessPool:
        raise BdmReadFailed("BDM 帧组装进程不可用，请稍后重试") from None


async def _read_identifier(
    client: BdmClient,
    config: BdmSourceConfig,
    window: BdmWindow,
    identifier: str,
    budget: _RequestBudget,
) -> _Read:
    result = _Read(identifier=identifier)
    windows = (
        formula_windows(window, config.granularity, config.interval_minutes)
        if config.kind == "formula"
        else history_windows(window)
    )
    for period in windows:
        if len(result.samples) >= config.row_limit:
            result.is_truncated = True
            break
        offset: int | None = 0
        while offset is not None and len(result.samples) <= config.row_limit:
            if len(result.samples) == config.row_limit:
                result.is_truncated = True
                break
            payload = _query(config, period, identifier, offset)
            budget.take()
            data = await client.read(
                QUERY_PATHS[config.kind], BdmSeriesData, payload=payload
            )
            series = _one_series(data, config.kind, identifier)
            _validate_formula(data, series, config, window)
            _merge(result, series, window)
            offset = (
                _next_offset(series, offset)
                if config.kind != "formula"
                else None
            )
        if len(result.samples) > config.row_limit or result.is_truncated:
            result.is_truncated = True
            break
    return result


def _query(
    config: BdmSourceConfig,
    period: dict[str, JsonValue],
    identifier: str,
    offset: int,
) -> dict[str, JsonValue]:
    payload: dict[str, JsonValue] = {
        **period,
        ID_FIELDS[config.kind]: [identifier],
    }
    if config.kind != "formula":
        payload.update(
            {
                "offset": offset,
                "limit": min(PAGE_SIZE, config.row_limit + 1),
                "sort": "desc",
            }
        )
    return payload


def _one_series(data: BdmSeriesData, kind: str, identifier: str) -> BdmSeries:
    if data.kind not in (None, kind) or len(data.series) != 1:
        raise BdmReadFailed("BDM 响应的序列数量或类别不匹配")
    series = data.series[0]
    received = (
        series.point_id
        if kind == "point"
        else series.property_id if kind == "raw" else series.code
    )
    if received != identifier:
        raise BdmReadFailed("BDM 返回了与请求不一致的标识")
    return series


def _validate_formula(
    data: BdmSeriesData,
    series: BdmSeries,
    config: BdmSourceConfig,
    window: BdmWindow,
) -> None:
    if config.kind != "formula" or config.granularity not in ("hour", "minute"):
        return
    if (
        data.interval_minutes != config.effective_interval_minutes
        or data.is_end_exclusive is not True
    ):
        raise BdmReadFailed(
            "能管接口未按请求粒度返回左闭右开分时结果，请确认上游支持小时/分钟查询"
        )
    for sample in series.samples:
        moment = sample_time(sample.ct, window).astimezone(window.timezone)
        if not is_interval_aligned(moment, config.effective_interval_minutes):
            raise BdmReadFailed("能管公式样本时间未按所选分钟间隔对齐")


def _merge(result: _Read, series: BdmSeries, window: BdmWindow) -> None:
    result.name = (
        series.name
        or " · ".join(
            part for part in (series.node_name, series.property_name) if part
        )
        or result.identifier
    )
    result.unit = series.unit
    for sample in series.samples:
        moment = sample_time(sample.ct, window)
        if not window.since <= moment < window.until:
            continue
        stamp = int(moment.timestamp() * 1000)
        value = sample.value
        if stamp in result.samples and result.samples[stamp] != value:
            raise BdmReadFailed("BDM 同一标识同一时刻存在冲突值，不能用于训练")
        result.samples[stamp] = value


def _next_offset(series: BdmSeries, offset: int) -> int | None:
    next_offset = series.next_offset
    if next_offset is not None and (
        not series.samples or next_offset <= offset or next_offset > MAX_OFFSET
    ):
        raise BdmReadFailed("BDM 分页未向前推进或超过上游 offset 上限")
    return next_offset


def _build_frame(
    reads: list[_Read],
    config: BdmSourceConfig,
    window: BdmWindow,
    now: datetime,
) -> Frame:
    stamps = sorted({stamp for result in reads for stamp in result.samples})
    truncated = len(stamps) > config.row_limit or any(
        result.is_truncated for result in reads
    )
    kept = stamps[-config.row_limit :]
    columns: list[FrameColumn] = []
    values: list[list[CellValue]] = []
    for result in reads:
        converted = [
            _coerce(result.samples.get(stamp), config.value_type)
            for stamp in kept
        ]
        columns.append(
            FrameColumn(
                key=result.identifier,
                name=result.name,
                unit=result.unit,
                dtype=config.value_type,
                coerce_failed=sum(int(failed) for _, failed in converted),
            )
        )
        values.append([value for value, _ in converted])
    return Frame(
        columns=tuple(columns),
        rows=tuple(
            tuple(column[index] for column in values)
            for index in range(len(kept))
        ),
        index=tuple(kept),
        provenance=Provenance(
            since=window.since,
            until=window.until,
            is_truncated=truncated,
            observed_until=now,
        ),
    )


def _coerce(value: CellValue, value_type: str) -> tuple[CellValue, bool]:
    if value is None:
        return None, False
    if value_type == "string":
        return str(value), False
    try:
        number = float(value)
    except (ValueError, OverflowError):
        return None, True
    return (number, False) if math.isfinite(number) else (None, True)


async def prefetch(
    connection: BdmConnection | None,
    graph: PipelineGraph,
    *,
    now: datetime,
    pool: NodePool | None = None,
) -> Prefetched:
    """预取外部源并逐节点记录失败。

    Args: connection, graph, now, pool。
    """
    frames: dict[str, Frame] = {}
    failures: dict[str, str] = {}
    for node in graph.nodes:
        if node.operator != "bdm_source":
            continue
        if connection is None:
            failures[node.id] = "BDM 接口未启用，请联系管理员配置连接"
            continue
        if pool is None:
            failures[node.id] = "BDM 帧计算资源未配置"
            continue
        config = BdmSourceConfig.model_validate(node.config)
        try:
            async with BdmClient(connection) as client:
                frames[node.id] = await load_frame(
                    client, config, now=now, pool=pool
                )
        except AppError as error:
            failures[node.id] = error.message
    return Prefetched(frames=frames, failures=failures)
