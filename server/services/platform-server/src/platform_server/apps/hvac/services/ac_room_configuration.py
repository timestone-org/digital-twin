"""批量读取房间配置、封存快照与校验指纹，供抽取和模型共用。"""

import hashlib
import json
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from decimal import Decimal

from pydantic import TypeAdapter
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.hvac.datasets import DATASET_RAW_MINUTE
from platform_server.apps.hvac.models import (
    AcDataBinding,
    AcMetricLimit,
    AcUnit,
)
from platform_server.apps.hvac.rooms import MetricBand, RoomUnit
from platform_server.apps.hvac.schemas.ac_compliance import WinterPeriodIn
from platform_server.apps.hvac.schemas.ac_configuration import (
    BoundUnitSnapshot,
    RoomConfigurationSnapshot,
    StoredWinterPolicy,
)
from platform_server.apps.hvac.schemas.ac_data import MetricLimitIn
from platform_server.apps.hvac.seasons import WinterPeriod
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules


@dataclass(frozen=True)
class BoundUnit:
    """一台空调及其数据源对象。"""

    unit: RoomUnit
    source_object: str


@dataclass(frozen=True)
class RoomConfiguration:
    """一个房间在抽取、训练和推理时共同校验的配置。"""

    units: tuple[BoundUnit, ...]
    members: tuple[str, ...]
    timezone: str
    rules_fingerprint: str
    rules: ExtractionRules

    def snapshot(self) -> dict[str, object]:
        return RoomConfigurationSnapshot(
            units=[_unit_snapshot(bound) for bound in self.units],
            members=list(self.members),
            timezone=self.timezone,
            rules_fingerprint=self.rules_fingerprint,
            rules=asdict(self.rules),
        ).model_dump(mode="json")

    def fingerprint(self) -> str:
        encoded = json.dumps(
            self.snapshot(), sort_keys=True, separators=(",", ":")
        )
        return hashlib.sha256(encoded.encode()).hexdigest()


def _limits(bands: Mapping[str, MetricBand]) -> list[MetricLimitIn]:
    return [
        MetricLimitIn(
            metric=metric,
            lower_limit=_decimal(band.lower),
            upper_limit=_decimal(band.upper),
        )
        for metric, band in sorted(bands.items())
    ]


def _decimal(value: Decimal | None) -> Decimal | None:
    return value.quantize(Decimal("0.01")) if value is not None else None


def _unit_snapshot(bound: BoundUnit) -> BoundUnitSnapshot:
    unit = bound.unit
    period = unit.winter_period
    winter = (
        None
        if period is None
        else StoredWinterPolicy(
            period=WinterPeriodIn(start=period.start, end=period.end),
            limits=_limits(unit.winter_bands),
        )
    )
    return BoundUnitSnapshot(
        serial=unit.serial,
        source_object=bound.source_object,
        non_winter=_limits(unit.bands),
        winter=winter,
    )


def bands_of(items: Sequence[MetricLimitIn]) -> dict[str, MetricBand]:
    """把校验过的存储值收敛为进程内范围。

    Args: items。"""
    return {
        item.metric: MetricBand(item.lower_limit, item.upper_limit)
        for item in items
        if item.lower_limit is not None or item.upper_limit is not None
    }


def room_unit(
    serial: str,
    bands: Mapping[str, MetricBand],
    winter: StoredWinterPolicy | None,
) -> RoomUnit:
    """构造不可变的机组计算配置。

    Args: serial, bands, winter。"""
    return RoomUnit(
        serial=serial,
        bands=bands,
        winter_period=(
            None
            if winter is None
            else WinterPeriod(winter.period.start, winter.period.end)
        ),
        winter_bands={} if winter is None else bands_of(winter.limits),
    )


def restore_configuration(raw: dict[str, object]) -> RoomConfiguration:
    """校验并恢复持久化快照。

    Args: raw。"""
    stored = RoomConfigurationSnapshot.model_validate(raw)
    return RoomConfiguration(
        units=tuple(
            BoundUnit(
                room_unit(unit.serial, bands_of(unit.non_winter), unit.winter),
                unit.source_object,
            )
            for unit in stored.units
        ),
        members=tuple(stored.members),
        timezone=stored.timezone,
        rules_fingerprint=stored.rules_fingerprint,
        rules=TypeAdapter(ExtractionRules).validate_python(stored.rules),
    )


async def _room_data(
    session: AsyncSession,
    room_ids: Sequence[uuid.UUID],
    *,
    should_lock_units: bool = False,
) -> tuple[dict[uuid.UUID, list[str]], dict[uuid.UUID, list[BoundUnit]]]:
    """单次查询读完整配置，避免两次查询夹入一次配置提交。

    Args: session, room_ids, should_lock_units。
    """
    if not room_ids:
        return {}, {}
    if should_lock_units:
        await session.execute(
            select(AcUnit.id)
            .where(AcUnit.room_id.in_(room_ids))
            .order_by(AcUnit.id)
            .with_for_update(read=True)
        )
    rows = (
        await session.execute(
            select(AcUnit, AcDataBinding.source_object, AcMetricLimit)
            .outerjoin(
                AcDataBinding,
                and_(
                    AcDataBinding.ac_unit_id == AcUnit.id,
                    AcDataBinding.dataset == DATASET_RAW_MINUTE,
                ),
            )
            .outerjoin(AcMetricLimit, AcMetricLimit.ac_unit_id == AcUnit.id)
            .where(AcUnit.room_id.in_(room_ids))
            .order_by(AcUnit.room_id, AcUnit.serial, AcMetricLimit.metric)
            .execution_options(populate_existing=True)
        )
    ).all()
    units: dict[uuid.UUID, tuple[AcUnit, str | None]] = {}
    limits: dict[uuid.UUID, dict[str, MetricBand]] = {}
    for unit, source, limit in rows:
        units[unit.id] = (unit, source)
        if limit is not None:
            limits.setdefault(unit.id, {})[limit.metric] = MetricBand(
                limit.lower_limit, limit.upper_limit
            )
    return _group_units(units, limits)


def _group_units(
    units: Mapping[uuid.UUID, tuple[AcUnit, str | None]],
    limits: Mapping[uuid.UUID, Mapping[str, MetricBand]],
) -> tuple[dict[uuid.UUID, list[str]], dict[uuid.UUID, list[BoundUnit]]]:
    members: dict[uuid.UUID, list[str]] = {}
    bound: dict[uuid.UUID, list[BoundUnit]] = {}
    for unit, source in units.values():
        members.setdefault(unit.room_id, []).append(unit.serial)
        if source is not None:
            winter = (
                None
                if unit.winter_policy is None
                else StoredWinterPolicy.model_validate(unit.winter_policy)
            )
            found = BoundUnit(
                room_unit(unit.serial, limits.get(unit.id, {}), winter), source
            )
            bound.setdefault(unit.room_id, []).append(found)
    return members, bound


async def load_bound_units(
    session: AsyncSession, room_id: uuid.UUID
) -> list[BoundUnit]:
    """批量读取已绑定机组的计算配置。

    Args: session, room_id。"""
    _, bound = await _room_data(session, [room_id])
    return bound.get(room_id, [])


async def load_configurations(
    session: AsyncSession,
    room_ids: Sequence[uuid.UUID],
    *,
    timezone: str,
    rules: ExtractionRules,
    should_lock_units: bool = False,
) -> dict[uuid.UUID, RoomConfiguration]:
    """批量建立房间配置，查询次数与房间数无关。

    Args: session, room_ids, timezone, rules。"""
    members, bound = await _room_data(
        session, room_ids, should_lock_units=should_lock_units
    )
    return {
        room_id: RoomConfiguration(
            tuple(bound.get(room_id, [])),
            tuple(members.get(room_id, [])),
            timezone,
            rules.fingerprint(),
            rules,
        )
        for room_id in room_ids
    }


async def load_configuration(
    session: AsyncSession,
    room_id: uuid.UUID,
    *,
    timezone: str,
    rules: ExtractionRules,
    should_lock_units: bool = False,
) -> RoomConfiguration:
    """读取一个房间的完整计算配置。

    Args: session, room_id, timezone, rules。"""
    found = await load_configurations(
        session,
        [room_id],
        timezone=timezone,
        rules=rules,
        should_lock_units=should_lock_units,
    )
    return found[room_id]
