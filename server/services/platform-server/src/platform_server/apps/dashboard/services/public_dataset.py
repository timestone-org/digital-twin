"""公开票据限定的台账最新值投影，不提供目录、原始行或历史查询。"""

from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from pydantic import JsonValue, TypeAdapter
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError
from lib.logging import get_logger
from platform_server.apps.dashboard.errors import DashboardNotPublished
from platform_server.apps.dashboard.models import DashboardBinding
from platform_server.apps.dashboard.schemas.share import (
    PublicDatasetLatestItemOut,
    PublicDatasetLatestOut,
)
from platform_server.apps.dashboard.services.share_service import (
    find_by_public_token,
)
from platform_server.apps.dashboard.services.state import load_state
from platform_server.apps.dataset.services import record_read

_logger = get_logger("platform.dashboard.public_dataset")
UNAVAILABLE_MESSAGE = "台账绑定暂不可用"
REFRESH_TOLERANCE_MS = 60_000
DATASET_KEY_PARTS = 3
DISABLED_DEADLINE = datetime(1970, 1, 1, tzinfo=UTC)


async def read_public_dataset_latest(
    session: AsyncSession, *, public_token: str
) -> PublicDatasetLatestOut:
    """按公开票据读取本屏台账绑定最新值。Args: session, public_token。"""
    dashboard = await find_by_public_token(session, public_token)
    if dashboard is None:
        raise DashboardNotPublished("公开链接无效或已被撤回")
    state = await load_state(session, dashboard.id)
    groups: dict[str, list[tuple[str, str]]] = defaultdict(list)
    found: dict[str, PublicDatasetLatestItemOut] = {}
    for key in _dataset_keys(state.bindings):
        parts = key.split(":")
        if (
            len(parts) != DATASET_KEY_PARTS
            or parts[0] != "ds"
            or not all(parts[1:])
        ):
            found[key] = _failure(key)
        else:
            groups[parts[1]].append((key, parts[2]))
    for code, wanted in sorted(groups.items()):
        for item in await _read_table(session, code=code, wanted=wanted):
            found[item.dataset_key] = item
    return PublicDatasetLatestOut(items=[found[key] for key in sorted(found)])


def _dataset_keys(bindings: Sequence[DashboardBinding]) -> list[str]:
    """提取本屏台账列身份并去重。Args: bindings。"""
    keys: set[str] = set()
    for binding in bindings:
        if binding.source_kind != "dataset":
            continue
        key = (binding.detail_json or {}).get("dataset_key")
        if isinstance(key, str) and key:
            keys.add(key)
    return sorted(keys)


async def _read_table(
    session: AsyncSession, *, code: str, wanted: list[tuple[str, str]]
) -> list[PublicDatasetLatestItemOut]:
    """按表隔离失败并限制返回列。Args: session, code, wanted。"""
    try:
        # ⚠ 查询失败后先回滚保存点，避免一张表的失败毒死其余表的事务。
        async with session.begin_nested():
            latest = await record_read.read_latest_by_code(session, code=code)
            return [
                _value_of(key, column=column, latest=latest)
                for key, column in wanted
            ]
    except (AppError, SQLAlchemyError, ValueError, TypeError) as error:
        _logger.warning(
            "public_dataset_latest_unavailable",
            "公开大屏的一组台账绑定暂不可用",
            error_type=type(error).__name__,
        )
        return [_failure(key) for key, _column in wanted]


def _value_of(
    key: str, *, column: str, latest: record_read.LatestByCode | None
) -> PublicDatasetLatestItemOut:
    """投影一个绑定列并保留时效边界。Args: key, column, latest。"""
    if latest is None:
        return _failure(key)
    if latest.ts is None:
        return PublicDatasetLatestItemOut(dataset_key=key, status="ok")
    if column not in latest.values:
        return _failure(key)
    adapter = TypeAdapter[JsonValue](JsonValue)
    value = adapter.validate_python(latest.values[column])
    return PublicDatasetLatestItemOut(
        dataset_key=key,
        status="ok",
        value=value,
        ts=latest.ts,
        stale_at=_stale_at(latest),
    )


def _stale_at(latest: record_read.LatestByCode) -> datetime | None:
    """沿用台账标量读取的陈旧判定截止时刻。Args: latest。"""
    if latest.ts is None or latest.collect_mode != "aggregate":
        return None
    if not latest.is_enabled:
        return DISABLED_DEADLINE
    return latest.ts + timedelta(
        milliseconds=latest.collect_interval_ms * 2 + REFRESH_TOLERANCE_MS
    )


def _failure(key: str) -> PublicDatasetLatestItemOut:
    return PublicDatasetLatestItemOut(
        dataset_key=key, status="error", message=UNAVAILABLE_MESSAGE
    )
