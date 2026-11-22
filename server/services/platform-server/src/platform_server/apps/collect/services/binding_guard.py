"""删除点位前检查大屏和台账引用，细节见 docs/COLLECT_DESIGN.md §5.2。"""

import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError
from platform_server.apps.collect.errors import PointInUse
from platform_server.apps.collect.services.point_reference_lock import (
    lock_point_references,
)
from platform_server.apps.dashboard.services import (
    BoundDashboard,
    dashboards_binding,
)

# 批量冲突提示最多点名几个点位
NAMED_LIMIT = 3

# ⚠ 台账回填读取采集服务，由入口装配台账的反查以避免服务循环导入
type LedgerReferences = Callable[
    [AsyncSession, Sequence[str]], Awaitable[dict[str, int]]
]


@dataclass(frozen=True)
class PointRef:
    """待删点位的身份与显示名，用来把冲突指回具体那一条。"""

    point_id: uuid.UUID
    node_key: str
    name: str


async def raise_if_bound(
    session: AsyncSession, *, node_key: str, ledger_references: LedgerReferences
) -> None:
    """点位还被大屏或台账列引用就拒绝删除。

    Args: session, node_key, ledger_references。
    """
    await lock_point_references(session, [node_key])
    bound = (await dashboards_binding(session, [node_key])).get(node_key, [])
    ledger_count = (await ledger_references(session, [node_key])).get(
        node_key, 0
    )
    if not bound and not ledger_count:
        return
    details = [_detail(item) for item in bound]
    if ledger_count:
        details.append(
            FieldError(
                field="dataset_columns",
                code="point_bound",
                message=f"有 {ledger_count} 个台账列引用此点位",
            )
        )
    counts = _reference_counts(len(bound), ledger_count)
    raise PointInUse(
        f"还有 {counts}绑着这个点位，请先解除绑定",
        details=tuple(details),
    )


def _detail(bound: BoundDashboard) -> FieldError:
    """把一张绑着它的大屏摊成字段级说明。

    ⚠ 名字与 id 都要给：只给 id 用户得挨个去查，只给名字则同名大屏分不清。
    Args: bound。
    """
    return FieldError(
        field=f"dashboards[{bound.dashboard_id}]",
        code="point_bound",
        message=f"{bound.dashboard_name} 上有 {bound.binding_count} 处绑定",
    )


async def raise_if_any_bound(
    session: AsyncSession,
    *,
    points: Sequence[PointRef],
    ledger_references: LedgerReferences,
) -> None:
    """整批拒绝删除，逐条点名仍有引用的点位。

    Args: session, points, ledger_references。
    """
    keys = [item.node_key for item in points]
    await lock_point_references(session, keys)
    bound = await dashboards_binding(session, keys)
    ledger = await ledger_references(session, keys)
    blocked = [
        item
        for item in points
        if item.node_key in bound or item.node_key in ledger
    ]
    if not blocked:
        return
    if ledger:
        reason = "仍有台账列或大屏引用" if bound else "仍有台账列引用"
    else:
        reason = "还被大屏绑着"
    raise PointInUse(
        f"这批里有 {len(blocked)} 个点位{reason}"
        f"（{_named(blocked)}），请先解除绑定",
        details=tuple(
            _blocked_detail(
                item,
                len(bound.get(item.node_key, [])),
                ledger.get(item.node_key, 0),
            )
            for item in blocked
        ),
    )


def _named(blocked: Sequence[PointRef]) -> str:
    """把删不掉的点位名拼成一句，多于 `NAMED_LIMIT` 个就收尾成「等」。

    Args: blocked。
    """
    shown = "、".join(item.name for item in blocked[:NAMED_LIMIT])
    return shown if len(blocked) <= NAMED_LIMIT else f"{shown} 等"


def _reference_counts(screen_count: int, ledger_count: int) -> str:
    """给出各类引用计数，省略没有引用的类别。

    Args: screen_count, ledger_count。
    """
    if not ledger_count:
        return f"{screen_count} 张大屏"
    if not screen_count:
        return f"{ledger_count} 个台账列"
    return f"{screen_count} 张大屏和 {ledger_count} 个台账列"


def _blocked_detail(
    point: PointRef, screen_count: int, ledger_count: int
) -> FieldError:
    """把一个删不掉的点位摊成字段级说明。

    Args: point, screen_count, ledger_count。
    """
    counts = _reference_counts(screen_count, ledger_count)
    return FieldError(
        field=f"points[{point.point_id}]",
        code="point_bound",
        message=f"{point.name} 被 {counts}绑着",
    )
