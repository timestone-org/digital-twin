"""删点位前的绑定检查：被大屏绑着就 409 并列出那些大屏。

⚠ 这条守卫正是配置面必须留在 platform 的理由（ADR-0001 理由一）：绑定表就在
同一个库里，问一句是进程内调用。跟着采集运行时走，它就得反向 RPC 回来问。
⚠ 只走 `apps/dashboard/services` 的公开面——跨功能模块不许伸进对方内部。
"""

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError
from platform_server.apps.collect.errors import PointInUse
from platform_server.apps.dashboard.services import (
    BoundDashboard,
    dashboards_binding,
)


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
