"""把报告期 API 响应转换为与台账一致的有界生效值快照。"""

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

import httpx
from pydantic import JsonValue

from lib.utils.timeutils import format_rfc3339
from platform_server.apps.dataset.services import ColumnSpec, EffectiveRow
from platform_server.apps.report.errors import ReportInvalid
from platform_server.apps.report.schemas.api_source import (
    ReportApiColumn,
    ReportApiConnection,
    ReportApiSource,
)
from platform_server.apps.report.schemas.common import Granularity
from platform_server.apps.report.services.api_request import (
    ApiRequest,
    fetch_requests,
)
from platform_server.apps.report.services.period import (
    WindowOptions,
    format_period,
    resolve_window,
)
from platform_server.apps.report.services.source import SourceData

type ApiJson = str | bool | int | Decimal | list[ApiJson] | dict[
    str, ApiJson
] | None
MAX_ROWS = 1000
MAX_JSON_DEPTH = 64
MAX_NUMBER_CHARACTERS = 128
MAX_NUMBER_DIGITS = 100
MAX_NUMBER_EXPONENT = 100
MAX_TEXT_CHARACTERS = 10_000
MAX_MAPPED_BYTES = 2_000_000
_VARIABLE = re.compile(r"\{\{\s*([A-Za-z_]+)\s*\}\}")
_STAMP = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})"
)


def _pointer(document: ApiJson, pointer: str) -> ApiJson:
    value = document
    for raw in pointer.split("/")[1:] if pointer else ():
        key = raw.replace("~1", "/").replace("~0", "~")
        if isinstance(value, dict) and key in value:
            value = value[key]
        elif isinstance(value, list) and re.fullmatch(r"0|[1-9]\d*", key):
            index = int(key)
            if index >= len(value):
                raise ReportInvalid("API 响应缺少已配置的字段，请检查字段映射")
            value = value[index]
        else:
            raise ReportInvalid("API 响应缺少已配置的字段，请检查字段映射")
    return value


def _json(payload: bytes) -> ApiJson:
    try:
        document: ApiJson = json.loads(
            payload, parse_float=Decimal, parse_constant=Decimal
        )
    except (ValueError, RecursionError, InvalidOperation):
        raise ReportInvalid("API 响应不是合法 JSON") from None
    pending = [(document, 0)]
    while pending:
        value, depth = pending.pop()
        if depth > MAX_JSON_DEPTH:
            raise ReportInvalid("API 响应 JSON 超过深度上限")
        if isinstance(value, Decimal) and not value.is_finite():
            raise ReportInvalid("API 响应包含非有限数值")
        if isinstance(value, dict):
            pending.extend((child, depth + 1) for child in value.values())
        elif isinstance(value, list):
            pending.extend((child, depth + 1) for child in value)
    return document


def _number(value: ApiJson) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise ReportInvalid("API 数字字段类型不匹配")
    if isinstance(value, str) and len(value) > MAX_NUMBER_CHARACTERS:
        raise ReportInvalid("API 数字字段超过精度或范围上限")
    try:
        number = Decimal(value)
    except InvalidOperation:
        raise ReportInvalid("API 数字字段不是有效数值") from None
    if not number.is_finite():
        raise ReportInvalid("API 数字字段必须是有限数值")
    if (
        len(number.as_tuple().digits) > MAX_NUMBER_DIGITS
        or abs(number.adjusted()) > MAX_NUMBER_EXPONENT
    ):
        raise ReportInvalid("API 数字字段超过精度或范围上限")
    return number


def _column_value(row: ApiJson, column: ReportApiColumn) -> object:
    value = _pointer(row, column.pointer)
    if value is None:
        return None
    if column.data_type == "number":
        return _number(value)
    expected = str if column.data_type == "text" else bool
    if not isinstance(value, expected):
        raise ReportInvalid(f"API 字段「{column.name}」类型不匹配")
    if isinstance(value, str) and len(value) > MAX_TEXT_CHARACTERS:
        raise ReportInvalid("API 文本字段超过 10000 字符上限")
    return value


@dataclass
class _MappingBudget:
    size_bytes: int = 0

    def include(self, key: str, value: object) -> None:
        encoded_value = (
            format(value, "f") if isinstance(value, Decimal) else value
        )
        try:
            self.size_bytes += len(
                json.dumps({key: encoded_value}, ensure_ascii=False).encode(
                    "utf-8"
                )
            )
        except UnicodeError:
            raise ReportInvalid("API 文本字段包含无效 Unicode 字符") from None
        if self.size_bytes > MAX_MAPPED_BYTES:
            raise ReportInvalid(
                "API 映射数据超过 2 MB 上限，请减少字段或查询范围"
            )


def _mapped_values(
    row: ApiJson, source: ReportApiSource, budget: _MappingBudget
) -> dict[str, object]:
    values: dict[str, object] = {}
    for column in source.columns:
        value = _column_value(row, column)
        budget.include(column.key, value)
        values[column.key] = value
    return values


def _stamp(row: ApiJson, pointer: str | None, fallback: datetime) -> datetime:
    if pointer is None:
        return fallback
    raw = _pointer(row, pointer)
    if not isinstance(raw, str) or not _STAMP.fullmatch(raw):
        raise ReportInvalid("API 时间字段须为带时区的 RFC3339 时间")
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(
            UTC
        )
    except ValueError:
        raise ReportInvalid("API 时间字段不是有效时间") from None


def _mapped(
    payload: bytes, source: ReportApiSource, since: datetime, until: datetime
) -> SourceData:
    selected = _pointer(_json(payload), source.rows_pointer)
    if not isinstance(selected, (dict, list)):
        raise ReportInvalid("API 记录路径必须指向对象或数组")
    rows = selected if isinstance(selected, list) else [selected]
    if len(rows) > MAX_ROWS:
        raise ReportInvalid("API 响应超过 1000 行，请缩小查询范围")
    budget = _MappingBudget()
    output = tuple(
        EffectiveRow(
            ts=_stamp(row, source.time_pointer, since),
            source=f"api:{source.code}",
            values=_mapped_values(row, source, budget),
        )
        for row in rows
    )
    if any(not since <= row.ts < until for row in output):
        raise ReportInvalid("API 返回时间超出所选报告期，请检查时间参数映射")
    return SourceData(
        rows=tuple(sorted(output, key=lambda row: row.ts)),
        columns=tuple(
            ColumnSpec(
                key=column.key,
                name=column.name,
                data_type=column.data_type,
                unit="",
            )
            for column in source.columns
        ),
        is_truncated=False,
    )


def _expand(value: str, variables: dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in variables:
            raise ReportInvalid("API 参数包含不支持的报告期变量")
        return variables[key]

    expanded = _VARIABLE.sub(replace, value)
    if "{{" in expanded or "}}" in expanded:
        raise ReportInvalid("API 参数包含不支持的报告期变量")
    return expanded


def _expand_body(value: JsonValue, variables: dict[str, str]) -> JsonValue:
    if isinstance(value, str):
        return _expand(value, variables)
    if isinstance(value, dict):
        return {
            key: _expand_body(child, variables) for key, child in value.items()
        }
    if isinstance(value, list):
        return [_expand_body(child, variables) for child in value]
    return value


@dataclass(frozen=True)
class _Period:
    period: str
    granularity: Granularity
    timezone: str


def _request(
    source: ReportApiSource, connection: ReportApiConnection, period: _Period
) -> tuple[ApiRequest, datetime, datetime]:
    zone = ZoneInfo(period.timezone)
    try:
        since, until = resolve_window(
            period.period,
            period.granularity,
            zone,
            WindowOptions(offset=source.offset),
        )
    except ValueError:
        raise ReportInvalid(
            "API 报告期格式与模板周期不匹配，请检查报告期"
        ) from None
    variables = {
        "period": format_period(since.astimezone(zone), period.granularity),
        "start": format_rfc3339(since),
        "end": format_rfc3339(until),
        "timezone": period.timezone,
    }
    body = source.body
    return (
        ApiRequest(
            source=source,
            connection=connection,
            query={
                key: _expand(value, variables)
                for key, value in source.query.items()
            },
            body=(
                {
                    key: _expand_body(value, variables)
                    for key, value in body.items()
                }
                if body is not None
                else None
            ),
        ),
        since,
        until,
    )


class ApiSourceReader:
    """带可注入 HTTP 传输的 API 快照读取器。"""

    def __init__(
        self,
        connections: Sequence[ReportApiConnection],
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._connections = {
            connection.code: connection for connection in connections
        }
        self._transport = transport

    async def fetch(
        self,
        sources: Sequence[ReportApiSource],
        period: str,
        granularity: Granularity,
        timezone: str,
    ) -> dict[str, SourceData]:
        """按定义一次取数并投影所有列。

        Args: sources, period, granularity, timezone。
        """
        wanted: list[tuple[ApiRequest, datetime, datetime]] = []
        for source in sources:
            connection = self._connections.get(source.connection)
            if connection is None:
                raise ReportInvalid(
                    f"API 连接「{source.connection}」未配置，请联系管理员"
                )
            wanted.append(
                _request(
                    source, connection, _Period(period, granularity, timezone)
                )
            )
        payloads = await fetch_requests(
            [item[0] for item in wanted], self._transport
        )
        found: dict[str, SourceData] = {}
        for (request, since, until), payload in zip(
            wanted, payloads, strict=True
        ):
            try:
                found[f"api:{request.source.code}"] = _mapped(
                    payload, request.source, since, until
                )
            except ReportInvalid as error:
                raise ReportInvalid(
                    f"数据来源「{request.source.name}」：{error.message}"
                ) from None
        return found


async def fetch_api_sources(
    sources: Sequence[ReportApiSource],
    connections: Sequence[ReportApiConnection],
    period: str,
    granularity: Granularity,
    timezone: str,
) -> dict[str, SourceData]:
    """生成或试算时获取报告 API 快照。

    Args: sources, connections, period, granularity, timezone。
    """
    return await ApiSourceReader(connections).fetch(
        sources, period, granularity, timezone
    )
