"""一台空调的两季范围原子保存，以及计算结果的范围回显。"""

import uuid
from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.utils.timeutils import utcnow
from platform_server.apps.hvac.errors import AcUnitNotFound
from platform_server.apps.hvac.models import AcMetricLimit, AcUnit
from platform_server.apps.hvac.rooms import RoomUnit
from platform_server.apps.hvac.schemas.ac_compliance import (
    CompliancePolicyIn,
    CompliancePolicyOut,
    EffectiveComplianceOut,
)
from platform_server.apps.hvac.schemas.ac_configuration import (
    StoredWinterPolicy,
)
from platform_server.apps.hvac.schemas.ac_data import (
    MetricLimitOut,
    MetricLimitsPutIn,
)
from platform_server.apps.hvac.seasons import WinterPeriod
from platform_server.apps.hvac.services import ac_data_service
from platform_server.apps.hvac.services.ac_configuration_guard import lock_unit

_logger = get_logger("platform.hvac.compliance")


async def read_policy(
    session: AsyncSession, unit_id: uuid.UUID, *, timezone: str
) -> CompliancePolicyOut:
    """读取完整配置与当前有效季节。

    Args: session, unit_id, timezone。"""
    unit, non_winter = await _stored_policy(session, unit_id)
    winter = (
        None
        if unit.winter_policy is None
        else StoredWinterPolicy.model_validate(unit.winter_policy)
    )
    at = utcnow()
    period = (
        None
        if winter is None
        else WinterPeriod(winter.period.start, winter.period.end)
    )
    return CompliancePolicyOut(
        winter_period=None if winter is None else winter.period,
        non_winter=non_winter,
        winter=(
            []
            if winter is None
            else [
                MetricLimitOut(
                    metric=item.metric,
                    lower_limit=_bound(item.lower_limit),
                    upper_limit=_bound(item.upper_limit),
                )
                for item in winter.limits
            ]
        ),
        effective_season=(
            "winter"
            if period is not None and period.contains(at, timezone)
            else "non_winter"
        ),
        effective_at=at,
        timezone=timezone,
    )


async def put_policy(
    session: AsyncSession,
    unit_id: uuid.UUID,
    payload: CompliancePolicyIn,
    *,
    timezone: str,
) -> CompliancePolicyOut:
    """日期和两套范围在同一事务中保存。

    Args: session, unit_id, payload, timezone。"""
    unit = await lock_unit(session, unit_id)
    await ac_data_service.replace_metric_limits(
        session,
        ac_unit_id=unit_id,
        payload=MetricLimitsPutIn(items=payload.non_winter),
    )
    unit.winter_policy = (
        None
        if payload.winter_period is None
        else StoredWinterPolicy(
            period=payload.winter_period,
            limits=payload.winter,
        ).model_dump(mode="json")
    )
    await session.flush()
    _logger.info(
        "ac_compliance_policy_set",
        "季节达标范围已保存",
        ac_unit_id=str(unit_id),
    )
    return await read_policy(session, unit_id, timezone=timezone)


def _bound(value: Decimal | None) -> Decimal | None:
    return value.quantize(Decimal("0.01")) if value is not None else None


def effective_compliance(
    units: Sequence[RoomUnit], at: datetime, timezone: str
) -> list[EffectiveComplianceOut]:
    """回显各台本次采用的季节与范围。

    Args: units, at, timezone。"""
    return [
        EffectiveComplianceOut(
            serial=unit.serial,
            season=unit.season_at(at, timezone),
            limits=[
                MetricLimitOut(
                    metric=metric,
                    lower_limit=band.lower,
                    upper_limit=band.upper,
                )
                for metric, band in sorted(unit.at(at, timezone).bands.items())
            ],
        )
        for unit in units
    ]


async def _stored_policy(
    session: AsyncSession, unit_id: uuid.UUID
) -> tuple[AcUnit, list[MetricLimitOut]]:
    """在同一数据库快照中读取日期及两套范围。Args: session, unit_id。"""
    rows = (
        await session.execute(
            select(AcUnit, AcMetricLimit)
            .outerjoin(AcMetricLimit, AcMetricLimit.ac_unit_id == AcUnit.id)
            .where(AcUnit.id == unit_id)
            .order_by(AcMetricLimit.metric)
            .execution_options(populate_existing=True)
        )
    ).all()
    if not rows:
        raise AcUnitNotFound("空调不存在")
    return rows[0][0], [
        MetricLimitOut(
            metric=limit.metric,
            lower_limit=limit.lower_limit,
            upper_limit=limit.upper_limit,
        )
        for _, limit in rows
        if limit is not None
    ]
