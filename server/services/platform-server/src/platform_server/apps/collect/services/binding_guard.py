"""删点位前的绑定检查：被大屏绑着就 409 并列出那些大屏。

⚠ 这条守卫正是配置面必须留在 platform 的理由（ADR-0001 理由一）：绑定表就在
同一个库里，问一句是进程内调用。跟着采集运行时走，它就得反向 RPC 回来问。
⚠ 只走 `apps/dashboard/services` 的公开面——跨功能模块不许伸进对方内部。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError
from platform_server.apps.collect.errors import PointInUse
from platform_server.apps.dashboard.services import (
    BoundDashboard,
    dashboards_binding,
)

# 批量冲突文案里最多点名几个点位。⚠ 全列出来会把一句提示撑成几百字
NAMED_LIMIT = 3


@dataclass(frozen=True)
class PointRef:
    """待删点位的身份与显示名，用来把冲突指回具体那一条。"""

    point_id: uuid.UUID
    node_key: str
    name: str


async def raise_if_bound(session: AsyncSession, *, node_key: str) -> None:
    """点位还被大屏绑着就拒绝删除。

    Args: session, node_key。
    """
    bound = (await dashboards_binding(session, [node_key])).get(node_key, [])
    if not bound:
        return
    raise PointInUse(
        f"还有 {len(bound)} 张大屏绑着这个点位，请先解除绑定",
        details=tuple(_detail(item) for item in bound),
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
    session: AsyncSession, *, points: Sequence[PointRef]
) -> None:
    """这一批里只要有一个还被大屏绑着就整批拒绝，并逐条点名。

    ⚠ 一次查完再判，不逐条问：整批是全删或全不删，逐条问会在撞上第一个被绑住
    的点位之前白打一串库。
    Args: session, points。
    """
    bound = await dashboards_binding(
        session, [item.node_key for item in points]
    )
    blocked = [item for item in points if bound.get(item.node_key)]
    if not blocked:
        return
    raise PointInUse(
        f"这批里有 {len(blocked)} 个点位还被大屏绑着"
        f"（{_named(blocked)}），请先解除绑定",
        details=tuple(
            _blocked_detail(item, bound[item.node_key]) for item in blocked
        ),
    )


def _named(blocked: Sequence[PointRef]) -> str:
    """把删不掉的点位名拼成一句，多于 `NAMED_LIMIT` 个就收尾成「等」。

    Args: blocked。
    """
    shown = "、".join(item.name for item in blocked[:NAMED_LIMIT])
    return shown if len(blocked) <= NAMED_LIMIT else f"{shown} 等"


def _blocked_detail(
    point: PointRef, bound: Sequence[BoundDashboard]
) -> FieldError:
    """把一个删不掉的点位摊成字段级说明。

    ⚠ 只给张数不逐张列大屏：一批 200 个点位各绑着几张屏时，逐张列会让 details
    长到没人读得完；要看是哪几张屏，单删那一条就会列出来。
    Args: point, bound。
    """
    return FieldError(
        field=f"points[{point.point_id}]",
        code="point_bound",
        message=f"{point.name} 被 {len(bound)} 张大屏绑着",
    )
