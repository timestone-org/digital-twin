"""点位管理面。事务边界在这一层：crud 不提交，api 不写业务。

⚠ 每个写路径都是「先跨进程校验、后开事务落库」。顺序不能倒：事务里禁止外部
IO（database-standard §6），而寻址串校验要往返一趟现场设备。代价是数据源不
存在时会白跑一次往返，这是拿一次浪费换「不在事务里等现场」。
"""

import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError
from lib.logging import get_logger
from lib.web import Page, PageParams
from platform_server.apps.collect.crud import point_crud
from platform_server.apps.collect.crud.point import DEFAULT_ORDER, SORTABLE
from platform_server.apps.collect.errors import (
    PointCodeTaken,
    PointInvalid,
    PointNotFound,
)
from platform_server.apps.collect.models import CollectPoint
from platform_server.apps.collect.schemas import (
    AddressCheckOut,
    PointBatchOut,
    PointCreateIn,
    PointItemIn,
    PointOut,
    PointSavedOut,
    PointUpdateIn,
)
from platform_server.apps.collect.services import binding_guard, source_service
from platform_server.apps.collect.services.address_check import (
    check_addresses,
    raise_if_rejected,
)
from platform_server.apps.collect.services.changes import given_changes
from platform_server.apps.collect.services.command_bus import CommandBus
from platform_server.apps.collect.services.presenters import to_point_out
from platform_server.apps.collect.services.transactions import (
    release_read_transaction,
)
from timeseries import compose_node_key

_logger = get_logger("platform.collect.point")


async def list_points(
    session: AsyncSession,
    *,
    source_id: uuid.UUID | None,
    keyword: str | None,
    page: PageParams,
    sort: str | None,
) -> Page[PointOut]:
    """点位列表。Agent 按名字找点也走它。

    Args: session, source_id, keyword, page, sort。
    """
    statement = point_crud.order_by_whitelist(
        point_crud.build_query(source_id=source_id, keyword=keyword),
        sort=sort,
        allowed=dict(SORTABLE),
        default=DEFAULT_ORDER,
    )
    rows, total = await point_crud.list_page(
        session, statement=statement, offset=page.offset, limit=page.size
    )
    return Page[PointOut](
        items=[to_point_out(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def create_points(
    session: AsyncSession, *, bus: CommandBus, payload: PointCreateIn
) -> PointBatchOut:
    """批量建点。先校验寻址串，再落库。

    Args: session, bus, payload。
    """
    source = await source_service.require_source(session, payload.source_id)
    source_id = source.id
    await release_read_transaction(session)
    checks = await check_addresses(
        bus,
        source_id=source_id,
        addresses=[item.address for item in payload.items],
    )
    raise_if_rejected(checks, field_of=_address_fields(payload))
    created = await _insert_points(session, source_id, payload)
    batch = PointBatchOut(
        items=[to_point_out(item) for item in created], address_checks=checks
    )
    await _commit(session)
    return batch


async def update_point(
    session: AsyncSession,
    *,
    bus: CommandBus,
    point_id: uuid.UUID,
    payload: PointUpdateIn,
) -> PointSavedOut:
    """改点位。改了寻址串就重新校验一次。

    Args: session, bus, point_id, payload。
    """
    point = await require_point(session, point_id)
    source_id, address = point.source_id, payload.address
    check = await _recheck(session, bus, source_id=source_id, address=address)
    point = await require_point(session, point_id)
    point_crud.apply_changes(point, given_changes(payload))
    await session.flush()
    saved = PointSavedOut(point=to_point_out(point), address_check=check)
    await _commit(session)
    _logger.info("collect_point_updated", "点位已更新", point_id=str(point.id))
    return saved


async def delete_point(
    session: AsyncSession, *, point_id: uuid.UUID, is_forced: bool = False
) -> str:
    """删点位，返回它的 `node_key`。

    ⚠ 先问「有没有大屏绑着它」：被绑着就 409 并列出那些大屏。删掉一个还被绑
    着的点位，大屏上那个槽会静默变成永远没有数据。
    ⚠ `is_forced` 是显式跳过这道守卫：仍绑着它的大屏引用就此失效——界面要
    在二次确认里把这句话说出来。
    Args: session, point_id, is_forced。
    """
    point = await require_point(session, point_id)
    node_key = compose_node_key(point.source_id, point.code)
    if not is_forced:
        await binding_guard.raise_if_bound(session, node_key=node_key)
    _logger.info(
        "collect_point_deleted",
        "点位已删除",
        point_id=str(point.id),
        is_forced=is_forced,
    )
    await point_crud.delete(session, point)
    await _commit(session)
    return node_key


async def delete_points(
    session: AsyncSession,
    *,
    point_ids: Sequence[uuid.UUID],
    is_forced: bool = False,
) -> int:
    """批量删点，返回删掉几个。

    ⚠ 整批全删或全不删：只要有一个还被大屏绑着，就整批 409 并点名那几个。
    部分成功会让界面上剩下的那几条看着像「没勾中」，用户于是再勾一次再删一次。
    ⚠ 撞见已经不在的点位一律 404，不静默跳过：别人刚删掉其中一条时，静默成功
    会让人以为自己删的是另一条，而那一条还好好地在表里。
    ⚠ `is_forced` 是显式跳过这道守卫：仍绑着它们的大屏引用就此失效——界面要
    在二次确认里把这句话说出来。
    Args: session, point_ids, is_forced。
    """
    wanted = list(dict.fromkeys(point_ids))
    points = await point_crud.list_by_ids(session, wanted)
    _raise_if_missing(wanted, points)
    if not is_forced:
        await binding_guard.raise_if_any_bound(
            session, points=[_point_ref(point) for point in points]
        )
    _logger.info(
        "collect_points_deleted",
        "点位已批量删除",
        point_total=len(points),
        is_forced=is_forced,
    )
    await point_crud.delete_many(session, wanted)
    await _commit(session)
    return len(points)


async def require_point(
    session: AsyncSession, point_id: uuid.UUID
) -> CollectPoint:
    """取点位，取不到即 404。

    Args: session, point_id。
    """
    point = await point_crud.get(session, point_id)
    if point is None:
        raise PointNotFound("点位不存在")
    return point


def _raise_if_missing(
    wanted: Sequence[uuid.UUID], found: Sequence[CollectPoint]
) -> None:
    """这一批里有点位不存在就整批 404 并报个数。

    Args: wanted, found。
    """
    known = {point.id for point in found}
    missing = [one for one in wanted if one not in known]
    if not missing:
        return
    raise PointNotFound(
        f"这批里有 {len(missing)} 个点位不存在，可能刚被删掉，请刷新后重试"
    )


def _point_ref(point: CollectPoint) -> binding_guard.PointRef:
    return binding_guard.PointRef(
        point_id=point.id,
        node_key=compose_node_key(point.source_id, point.code),
        name=point.name,
    )


async def _commit(session: AsyncSession) -> None:
    """就地提交。

    ⚠ 不能等依赖退出时再提交：计划变更通知紧跟在路由函数里发出，而 FastAPI 把
    「发响应」放在 yield 依赖的退出栈**里面**——不就地提交，collector 收到通知
    时重拉到的还是旧配置，而它不会再拉第二次。
    Args: session。
    """
    await session.commit()


async def _recheck(
    session: AsyncSession,
    bus: CommandBus,
    *,
    source_id: uuid.UUID,
    address: str | None,
) -> AddressCheckOut | None:
    """本次改了寻址串就校验一次；没改就不打扰现场。

    Args: session, bus, source_id, address。
    """
    if address is None:
        return None
    await release_read_transaction(session)
    checks = await check_addresses(
        bus, source_id=source_id, addresses=[address]
    )
    raise_if_rejected(checks, field_of={address: "address"})
    return checks[0]


async def _insert_points(
    session: AsyncSession, source_id: uuid.UUID, payload: PointCreateIn
) -> list[CollectPoint]:
    """落库一批点位。编码撞了就整批 409，不部分成功。

    Args: session, source_id, payload。
    """
    _raise_if_duplicated_in_batch(payload)
    codes = [item.code for item in payload.items]
    taken = await point_crud.taken_codes(session, source_id, codes)
    if taken:
        raise PointCodeTaken(
            f"这些点位编码在该数据源下已存在：{'、'.join(sorted(taken))}"
        )
    created = [_new_point(source_id, item) for item in payload.items]
    for point in created:
        point_crud.add(session, point)
    await session.flush()
    _logger.info(
        "collect_points_created",
        "点位已创建",
        source_id=str(source_id),
        point_total=len(created),
    )
    return created


def _raise_if_duplicated_in_batch(payload: PointCreateIn) -> None:
    """同一批里撞编码就 400 并指到第二次出现的那一项。

    ⚠ 不靠库上的唯一约束兜：一次 flush 里两条同编码会报成一句和字段无关的
    完整性错误，调用方看不出是哪一项写重了。
    Args: payload。
    """
    seen: dict[str, int] = {}
    for position, item in enumerate(payload.items):
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


def _address_fields(payload: PointCreateIn) -> dict[str, str]:
    """寻址串 → 请求体里的字段路径，供错误 details 指到具体输入框。

    Args: payload。
    """
    fields: dict[str, str] = {}
    for position, item in enumerate(payload.items):
        fields.setdefault(item.address, f"items[{position}].address")
    return fields


def _new_point(source_id: uuid.UUID, item: PointItemIn) -> CollectPoint:
    return CollectPoint(
        source_id=source_id,
        code=item.code,
        name=item.name,
        address=item.address,
        data_type=item.data_type,
        unit=item.unit,
        sampling_interval_ms=item.sampling_interval_ms,
        deadband=item.deadband,
        archive_enabled=item.archive_enabled,
        archive_max_interval_ms=item.archive_max_interval_ms,
        archive_retention_days=item.archive_retention_days,
    )


async def strictest_retention_days(
    session: AsyncSession, *, points: Sequence[tuple[uuid.UUID, str]]
) -> int | None:
    """这批点位里**最短**的那个保留期；一个有下界的都没有时给 None。

    ⚠ 取最短而不是最长：保留期最短的那个点位一到边界就只剩半桶样本，而半桶
    折算出来是个错的数，写出去之后与一个真实的低值长得一模一样。宁可让保留期
    长的那几列少补一段（它们仍可以分开建表回填），也不要留下一格错的数。
    ⚠ 永久保留（`None`）不参与比较：它对下界没有意见，不是「零天」。
    Args: session, points（`(source_id, code)` 对）。
    """
    found = [
        days
        for days in await point_crud.retention_days_of(session, points)
        if days is not None
    ]
    return min(found) if found else None
