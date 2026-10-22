"""配置写入与抽取、训练终态快照在真实双事务中互斥。"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from decimal import Decimal

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from unit.source_fakes import FakeAcSource, full_shape

from lib.db import Database
from lib.errors import Conflict
from platform_server.apps.hvac.crud import room_crud
from platform_server.apps.hvac.models import (
    AcDataBinding,
    AcMetricLimit,
    AcUnit,
    Room,
    Workshop,
)
from platform_server.apps.hvac.schemas import (
    AcDataBindingPutIn,
    AcUnitCreateIn,
    AcUnitRelocateIn,
    AcUnitUpdateIn,
    MetricLimitIn,
    MetricLimitsPutIn,
)
from platform_server.apps.hvac.schemas.ac_compliance import (
    CompliancePolicyIn,
    WinterPeriodIn,
)
from platform_server.apps.hvac.services import (
    ac_compliance_service,
    ac_data_service,
    ac_unit_service,
)
from platform_server.apps.hvac.services.ac_room_configuration import (
    load_configuration,
)
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules


@dataclass(frozen=True)
class ConfigurationCase:
    """提交到独立事务、供并发读写的房间配置。"""

    database: Database
    workshop_id: uuid.UUID
    room_id: uuid.UUID
    other_room_id: uuid.UUID
    empty_room_id: uuid.UUID
    unit_id: uuid.UUID
    unbound_unit_id: uuid.UUID
    movable_unit_id: uuid.UUID


async def _seed_case(database: Database) -> ConfigurationCase:
    async with database.session() as session:
        workshop = Workshop(name=f"配置并发{uuid.uuid4().hex}")
        session.add(workshop)
        await session.flush()
        rooms = [
            Room(workshop_id=workshop.id, name=name)
            for name in ("快照房间", "迁入来源", "空房间")
        ]
        session.add_all(rooms)
        await session.flush()
        room, other, empty = rooms
        units = [
            AcUnit(room_id=found.id, serial=uuid.uuid4().hex, name="被测空调")
            for found in (room, room, other)
        ]
        session.add_all(units)
        await session.flush()
        unit, unbound, movable = units
        session.add(
            AcDataBinding(
                ac_unit_id=unit.id, dataset="raw_minute", source_object="Before"
            )
        )
    return ConfigurationCase(
        database,
        workshop.id,
        room.id,
        other.id,
        empty.id,
        unit.id,
        unbound.id,
        movable.id,
    )


async def _clear_case(case: ConfigurationCase) -> None:
    async with case.database.session() as session:
        room_ids = (case.room_id, case.other_room_id, case.empty_room_id)
        units = select(AcUnit.id).where(AcUnit.room_id.in_(room_ids))
        await session.execute(
            delete(AcDataBinding).where(AcDataBinding.ac_unit_id.in_(units))
        )
        await session.execute(
            delete(AcMetricLimit).where(AcMetricLimit.ac_unit_id.in_(units))
        )
        await session.execute(
            delete(AcUnit).where(AcUnit.room_id.in_(room_ids))
        )
        await session.execute(delete(Room).where(Room.id.in_(room_ids)))
        await session.execute(
            delete(Workshop).where(Workshop.id == case.workshop_id)
        )


@pytest.fixture
async def configuration_case(
    db_session: AsyncSession,
) -> AsyncIterator[ConfigurationCase]:
    database = Database(
        dsn=db_session.get_bind().engine.url.render_as_string(
            hide_password=False
        ),
        search_path="platform",
    )
    case = await _seed_case(database)
    try:
        yield case
    finally:
        await _clear_case(case)
        await database.dispose()


def _complete_limits() -> list[MetricLimitIn]:
    return [
        MetricLimitIn(
            metric=metric,
            lower_limit=Decimal(lower),
            upper_limit=Decimal(upper),
        )
        for metric, lower, upper in (
            ("workshop_temp_avg", "20", "25"),
            ("workshop_humidity_avg", "40", "60"),
        )
    ]


async def _write_members(
    session: AsyncSession, case: ConfigurationCase, operation: str
) -> None:
    if operation in {"new_member", "new_empty_member"}:
        target = (
            case.empty_room_id
            if operation == "new_empty_member"
            else case.room_id
        )
        await ac_unit_service.create_ac_unit(
            session,
            payload=AcUnitCreateIn(
                room_id=target, serial=uuid.uuid4().hex, name="新增成员"
            ),
        )
    elif operation == "move_member":
        await ac_unit_service.update_ac_unit(
            session,
            ac_unit_id=case.movable_unit_id,
            payload=AcUnitUpdateIn(room_id=case.room_id),
        )
    elif operation == "bulk_move_member":
        await ac_unit_service.relocate_ac_units(
            session,
            payload=AcUnitRelocateIn(
                room_id=case.room_id, ac_unit_ids=[case.movable_unit_id]
            ),
        )
    elif operation == "rename_member":
        await ac_unit_service.update_ac_unit(
            session,
            ac_unit_id=case.unit_id,
            payload=AcUnitUpdateIn(serial=uuid.uuid4().hex),
        )
    else:
        assert operation == "delete_member"
        await ac_unit_service.delete_ac_unit(
            session, ac_unit_id=case.unbound_unit_id
        )


async def _apply_change(
    session: AsyncSession, case: ConfigurationCase, operation: str
) -> None:
    if operation == "binding_update":
        source = FakeAcSource(columns={"After": full_shape()})
        await ac_data_service.put_binding(
            session,
            AcSourceReader(source=source, timezone="Asia/Shanghai"),
            ac_unit_id=case.unit_id,
            dataset="raw_minute",
            payload=AcDataBindingPutIn(source_object="After"),
        )
    elif operation == "binding_delete":
        await ac_data_service.delete_binding(
            session, ac_unit_id=case.unit_id, dataset="raw_minute"
        )
    elif operation == "limits":
        await ac_data_service.put_metric_limits(
            session,
            ac_unit_id=case.unit_id,
            payload=MetricLimitsPutIn(items=_complete_limits()),
        )
    elif operation == "policy":
        await ac_compliance_service.put_policy(
            session,
            case.unit_id,
            CompliancePolicyIn(
                winter_period=WinterPeriodIn(start="11-15", end="03-15"),
                non_winter=_complete_limits(),
                winter=_complete_limits(),
            ),
            timezone="Asia/Shanghai",
        )
    else:
        await _write_members(session, case, operation)


async def _write_configuration(
    case: ConfigurationCase, ready: asyncio.Future[int], operation: str
) -> None:
    async with case.database.session() as session:
        process_id = await session.scalar(text("SELECT pg_backend_pid()"))
        assert isinstance(process_id, int)
        ready.set_result(process_id)
        await _apply_change(session, case, operation)


async def _require_waiting(
    case: ConfigurationCase, writer: asyncio.Task[None], process_id: int
) -> None:
    async with case.database.session() as observer:
        async with asyncio.timeout(2):
            while not writer.done():
                blocked = await observer.scalar(
                    text(
                        "SELECT cardinality(pg_blocking_pids(:process_id)) > 0"
                    ),
                    {"process_id": process_id},
                )
                if blocked:
                    return
        await writer
        pytest.fail("配置写入越过了终态快照的事务边界")


@pytest.mark.parametrize(
    "operation",
    [
        "binding_update",
        "binding_delete",
        "new_member",
        "new_empty_member",
        "move_member",
        "bulk_move_member",
        "rename_member",
        "delete_member",
        "limits",
        "policy",
    ],
)
async def test_configuration_changes_wait_for_final_snapshot(
    configuration_case: ConfigurationCase, operation: str
) -> None:
    case = configuration_case
    ready: asyncio.Future[int] = asyncio.get_running_loop().create_future()
    room_id = (
        case.empty_room_id if operation == "new_empty_member" else case.room_id
    )
    async with case.database.session() as snapshot:
        before = await load_configuration(
            snapshot,
            room_id,
            timezone="Asia/Shanghai",
            rules=ExtractionRules(),
            should_lock_units=True,
        )
        writer = asyncio.create_task(
            _write_configuration(case, ready, operation)
        )
        try:
            await _require_waiting(case, writer, await ready)
        finally:
            await snapshot.commit()
            await writer
    async with case.database.session() as session:
        after = await load_configuration(
            session, room_id, timezone="Asia/Shanghai", rules=ExtractionRules()
        )
        assert before.fingerprint() != after.fingerprint()


async def test_unit_relocation_while_waiting_rejects_configuration_write(
    configuration_case: ConfigurationCase,
) -> None:
    case = configuration_case
    ready: asyncio.Future[int] = asyncio.get_running_loop().create_future()
    async with case.database.session() as mover:
        await room_crud.lock_configuration(mover, frozenset({case.room_id}))
        writer = asyncio.create_task(
            _write_configuration(case, ready, "binding_delete")
        )
        try:
            await _require_waiting(case, writer, await ready)
            await ac_unit_service.update_ac_unit(
                mover,
                ac_unit_id=case.unit_id,
                payload=AcUnitUpdateIn(room_id=case.other_room_id),
            )
        finally:
            await mover.commit()
            with pytest.raises(Conflict, match="所属房间已变化"):
                await writer
    async with case.database.session() as session:
        bindings = await ac_data_service.list_bindings(
            session, ac_unit_id=case.unit_id
        )
        assert bindings.items[0].source_object == "Before"
