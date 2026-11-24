"""按对齐的归档分钟计算空压机代表工况。"""

from datetime import UTC, datetime, timedelta
from math import isfinite
from uuid import UUID

from sqlalchemy import text

from lib.db import Database
from platform_server.apps.collect.services import ReadOnlyHistorySource
from platform_server.apps.compressed_air.config import (
    CompressedAirConfig,
    MachinePoints,
)
from platform_server.apps.compressed_air.models import Curves, Knot
from platform_server.settings import DB_SCHEMA
from timeseries import HISTORY_SCHEMA, HISTORY_TABLE, split_node_key

# SQL 唯一拼入的内容是项目归档表常量，各点位、时窗和阈值均参数化。
_ANCHORS = f"""WITH samples AS (
    SELECT date_trunc('minute', ts) AS minute,
        source_id, point_code,
        CASE WHEN (source_id, point_code) = (CAST(:source_0 AS uuid), :code_0)
             THEN max(value_num) ELSE avg(value_num) END AS value
    FROM {HISTORY_SCHEMA}.{HISTORY_TABLE}
    WHERE (source_id, point_code) IN (
        (CAST(:source_0 AS uuid), :code_0), (CAST(:source_1 AS uuid), :code_1),
        (CAST(:source_2 AS uuid), :code_2), (CAST(:source_3 AS uuid), :code_3)
    ) AND ts >= :range_start AND ts < :range_end AND quality = 'good'
    GROUP BY minute, source_id, point_code
), aligned AS (
    SELECT minute,
        max(value) FILTER (WHERE (source_id, point_code) =
            (CAST(:source_0 AS uuid), :code_0)) AS volume,
        max(value) FILTER (WHERE (source_id, point_code) =
            (CAST(:source_1 AS uuid), :code_1)) AS power,
        max(value) FILTER (WHERE (source_id, point_code) =
            (CAST(:source_2 AS uuid), :code_2)) AS pressure,
        max(value) FILTER (WHERE (source_id, point_code) =
            (CAST(:source_3 AS uuid), :code_3)) AS speed
    FROM samples GROUP BY minute
), flow_minute AS (
    SELECT *,
        CASE WHEN minute - lag(minute) OVER step = interval '1 minute'
             AND volume >= lag(volume) OVER step
             THEN (volume - lag(volume) OVER step) * :volume_scale END AS flow
    FROM aligned WINDOW step AS (ORDER BY minute)
), steady AS (
    SELECT *, lag(minute) OVER step AS previous_minute,
        lag(flow) OVER step AS previous_flow,
        lag(power) OVER step AS previous_power
    FROM flow_minute WINDOW step AS (ORDER BY minute)
)
SELECT coalesce(floor(speed / 200 + 0.5), 0) AS band,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY flow) AS flow,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY power) AS power
FROM steady
WHERE flow >= 2 AND power >= 20
    AND pressure BETWEEN :pressure_min AND :pressure_max
    AND (:is_fixed OR speed > 0)
    AND minute - previous_minute = interval '1 minute'
    AND abs(flow - previous_flow) <= greatest(0.8, flow * 0.10)
    AND abs(power - previous_power) <= greatest(5.0, power * 0.10)
GROUP BY band
HAVING count(*) >= :minimum_samples
    AND count(DISTINCT date_trunc('day', minute)) >= 3
ORDER BY band
LIMIT :band_limit"""  # noqa: S608

MAX_BANDS = 32

_DATASET_ANCHORS = f"""WITH observed AS (
    SELECT DISTINCT ON (date_trunc('minute', ts))
        date_trunc('minute', ts) AS minute, values_json
    FROM {DB_SCHEMA}.dataset_records
    WHERE table_id = :table_id AND ts >= :range_start AND ts < :range_end
    ORDER BY date_trunc('minute', ts), ts DESC, row_id DESC
), minutes AS (
    SELECT observed.minute, machine.*
    FROM observed
    CROSS JOIN LATERAL jsonb_to_record(observed.values_json) AS sample(
        flow_1 double precision, flow_2 double precision,
        flow_3 double precision, flow_4 double precision,
        power_1 double precision, power_2 double precision,
        power_3 double precision, power_4 double precision,
        pressure_1 double precision, pressure_2 double precision,
        pressure_3 double precision, pressure_4 double precision,
        rpm_2 double precision, rpm_3 double precision, rpm_4 double precision
    )
    CROSS JOIN LATERAL (VALUES
        (1, flow_1, power_1, pressure_1, NULL::double precision),
        (2, flow_2, power_2, pressure_2, rpm_2),
        (3, flow_3, power_3, pressure_3, rpm_3),
        (4, flow_4, power_4, pressure_4, rpm_4)
    ) AS machine(number, flow, power, pressure, speed)
), steady AS (
    SELECT *, lag(minute) OVER step AS previous_minute,
        lag(flow) OVER step AS previous_flow,
        lag(power) OVER step AS previous_power
    FROM minutes WINDOW step AS (PARTITION BY number ORDER BY minute)
), anchors AS (
    SELECT number, coalesce(floor(speed / 200 + 0.5), 0) AS band,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY flow) AS flow,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY power) AS power
    FROM steady
    WHERE flow >= 2 AND power >= 20
        AND pressure BETWEEN :pressure_min AND :pressure_max
        AND ((number = 1 AND flow >= 30 AND power >= 225) OR speed > 0)
        AND minute - previous_minute = interval '1 minute'
        AND abs(flow - previous_flow) <= greatest(0.8, flow * 0.10)
        AND abs(power - previous_power) <= greatest(5.0, power * 0.10)
    GROUP BY number, band
    HAVING count(*) >= :minimum_samples
        AND count(DISTINCT date_trunc('day', minute)) >= 3
), ranked AS (
    SELECT *, row_number() OVER (PARTITION BY number ORDER BY band) AS position
    FROM anchors
)
SELECT number, flow, power FROM ranked
WHERE position <= :band_limit
ORDER BY number, band"""  # noqa: S608


async def load_curves(
    history: ReadOnlyHistorySource, config: CompressedAirConfig
) -> Curves:
    """按最近归档重算四台的可用曲线。Args: history, config。"""
    common = _calibration_window(config)
    result: Curves = {}
    for index, machine in enumerate(config.machines, 1):
        if machine is None:
            continue
        rows = await history.fetch_all(
            _ANCHORS, {**common, **_point_params(machine)}
        )
        knots = _increasing_knots(rows)
        if len(rows) <= MAX_BANDS and len(knots) >= (
            1 if machine.speed is None else 2
        ):
            result[index] = knots
    return result


async def load_dataset_curves(
    database: Database, config: CompressedAirConfig, table_id: UUID
) -> Curves:
    """从实测标定台账拟合。Args: database, config, table_id。"""
    params = {**_calibration_window(config), "table_id": table_id}
    async with database.session() as session:
        await session.execute(text("SET TRANSACTION READ ONLY"))
        await session.execute(text("SET LOCAL statement_timeout = '5000ms'"))
        result = await session.execute(text(_DATASET_ANCHORS), params)
        rows: list[dict[str, object]] = [dict(row) for row in result.mappings()]
    return _dataset_curves(rows)


def _calibration_window(config: CompressedAirConfig) -> dict[str, object]:
    """构造滚动历史窗口及工况门槛。Args: config。"""
    now = datetime.now(UTC)
    return {
        "range_start": now - timedelta(days=config.calibration_days),
        "range_end": now,
        "pressure_min": config.calibration_pressure_min,
        "pressure_max": config.calibration_pressure_max,
        "minimum_samples": config.minimum_samples_per_band,
        "band_limit": MAX_BANDS + 1,
    }


def _dataset_curves(rows: list[dict[str, object]]) -> Curves:
    """逐台限制样本分档并筛出单调锚点。Args: rows。"""
    curves: Curves = {}
    for number in range(1, 5):
        bands = [row for row in rows if row.get("number") == number]
        knots = _increasing_knots(bands)
        if len(bands) <= MAX_BANDS and len(knots) >= (1 if number == 1 else 2):
            curves[number] = knots
    return curves


def _point_params(machine: MachinePoints) -> dict[str, object]:
    """将可配置身份拆为绑定参数。Args: machine。"""
    params: dict[str, object] = {
        "is_fixed": machine.speed is None,
        "source_3": None,
        "code_3": "",
        "volume_scale": machine.volume_scale,
    }
    for index, key in enumerate(machine.keys):
        source, code = split_node_key(key)
        params[f"source_{index}"] = str(source)
        params[f"code_{index}"] = code
    return params


def _increasing_knots(rows: list[dict[str, object]]) -> tuple[Knot, ...]:
    """保留流量、功率单调且可插值的工况。Args: rows。"""
    points: list[Knot] = []
    for row in rows:
        flow, power = row.get("flow"), row.get("power")
        if not isinstance(flow, float) or not isinstance(power, float):
            continue
        if not isfinite(flow) or not isfinite(power):
            continue
        if not points or (flow > points[-1].flow and power > points[-1].power):
            points.append(Knot(flow, power))
    return tuple(points)
