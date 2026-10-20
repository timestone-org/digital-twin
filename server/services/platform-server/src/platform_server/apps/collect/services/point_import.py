"""按数据源与编码原地导入点位；事务外校验地址，事务内批量写入。"""

from collections.abc import Sequence

from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError
from lib.logging import get_logger
from platform_server.apps.collect.crud import point_crud
from platform_server.apps.collect.errors import PointCodeTaken, PointInvalid
from platform_server.apps.collect.models import CollectPoint
from platform_server.apps.collect.schemas import AddressCheckOut, PointItemIn
from platform_server.apps.collect.schemas.point_import import (
    PointImportIn,
    PointImportItemIn,
    PointImportOut,
)
from platform_server.apps.collect.services import source_service
from platform_server.apps.collect.services.address_check import (
    check_addresses,
    raise_if_rejected,
)
from platform_server.apps.collect.services.command_bus import CommandBus
from platform_server.apps.collect.services.http_profile import (
    validate_http_address,
)
from platform_server.apps.collect.services.presenters import to_point_out
from platform_server.apps.collect.services.transactions import (
    release_read_transaction,
)

_logger = get_logger("platform.collect.point_import")


async def import_points(
    session: AsyncSession, *, bus: CommandBus, payload: PointImportIn
) -> PointImportOut:
    """导入一批点位并提交。Args: session, bus, payload。"""
    _check_duplicate_codes(payload.items)
    source = await source_service.require_source(session, payload.source_id)
    existing = await point_crud.taken_codes(
        session, payload.source_id, [item.code for item in payload.items]
    )
    addresses: dict[str, str] = {}
    for position, item in enumerate(payload.items):
        if item.code not in existing:
            _new_item(item, position)
        elif payload.is_skipping_existing:
            continue
        if item.address is not None:
            field = f"items[{position}].address"
            validate_http_address(source.protocol, item.address, field=field)
            addresses.setdefault(item.address, field)
    await release_read_transaction(session)
    checks = (
        await check_addresses(
            bus, source_id=payload.source_id, addresses=list(addresses)
        )
        if addresses
        else []
    )
    raise_if_rejected(checks, field_of=addresses)
    result = await _save_import(session, payload, checks)
    await session.commit()
    _logger.info(
        "collect_points_imported",
        "点位已导入",
        source_id=str(payload.source_id),
        created_count=result.created_count,
        updated_count=result.updated_count,
    )
    return result


async def _save_import(
    session: AsyncSession, payload: PointImportIn, checks: list[AddressCheckOut]
) -> PointImportOut:
    """锁定匹配项后应用非空字段。Args: session, payload, checks。"""
    await source_service.require_source(session, payload.source_id)
    found = await point_crud.lock_by_codes(
        session,
        payload.source_id,
        [item.code for item in payload.items],
    )
    existing = {point.code: point for point in found}
    points: list[CollectPoint] = []
    created_count = updated_count = 0
    for position, item in enumerate(payload.items):
        point = existing.get(item.code)
        if point is None:
            validated = _new_item(item, position)
            point = CollectPoint(
                source_id=payload.source_id, **validated.model_dump()
            )
            point_crud.add(session, point)
            created_count += 1
        elif not payload.is_skipping_existing and _apply_item(point, item):
            updated_count += 1
        points.append(point)
    await _flush_import(session)
    return PointImportOut(
        items=[to_point_out(point) for point in points],
        address_checks=checks,
        created_count=created_count,
        updated_count=updated_count,
        unchanged_count=len(points) - created_count - updated_count,
    )


async def _flush_import(session: AsyncSession) -> None:
    """将并发新增的编码冲突收敛为 409。Args: session。"""
    try:
        await session.flush()
    except IntegrityError as error:
        cause = getattr(error.orig, "__cause__", None)
        if (
            getattr(cause, "constraint_name", None)
            != "uq_collect_points_source_id_code"
        ):
            raise
        raise PointCodeTaken(
            "导入期间有点位编码被其他请求创建，本批未保存，请刷新后重试"
        ) from error


def _apply_item(point: CollectPoint, item: PointImportItemIn) -> bool:
    """只赋值实际变化的字段，保留空白和未变化的更新时间。Args: point, item。"""
    changes = {
        name: value
        for name, value in item.model_dump(
            exclude_unset=True, exclude={"code"}
        ).items()
        if getattr(point, name) != value
    }
    point_crud.apply_changes(point, changes)
    return bool(changes)


def _new_item(item: PointImportItemIn, position: int) -> PointItemIn:
    """新增项使用创建约束，错误指回导入行。Args: item, position。"""
    try:
        return PointItemIn.model_validate(item.model_dump(exclude_unset=True))
    except ValidationError as error:
        raise PointInvalid(
            "新增点位需要完整的名称与寻址串",
            details=tuple(
                FieldError(
                    field=(
                        f"items[{position}]."
                        + ".".join(str(part) for part in detail["loc"])
                    ),
                    code=detail["type"],
                    message=detail["msg"],
                )
                for detail in error.errors()
            ),
        ) from error


def _check_duplicate_codes(items: Sequence[PointImportItemIn]) -> None:
    """拒绝同批重复编码。Args: items。"""
    seen: dict[str, int] = {}
    for position, item in enumerate(items):
        first = seen.get(item.code)
        if first is not None:
            raise PointInvalid(
                "同一批里有重复的点位编码",
                details=(
                    FieldError(
                        field=f"items[{position}].code",
                        code="duplicate_code",
                        message=f"与 items[{first}] 的编码相同",
                    ),
                ),
            )
        seen[item.code] = position
