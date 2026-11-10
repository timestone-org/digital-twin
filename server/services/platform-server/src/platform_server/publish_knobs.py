"""发布循环的运行参数：运行参数页「大屏」那一组的读取与收敛。

⚠ 页面标着「即时生效」，故循环跟对账同节奏重读，不是只在启动时读环境变量。
"""

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.runtime_params.catalog import (
    SECTION_DASHBOARD,
    ParamValue,
)
from platform_server.apps.runtime_params.services import param_service
from platform_server.settings import (
    PUBLISH_MAX_ITEMS_CEILING,
    PUBLISH_WINDOW_FLOOR_MS,
    Settings,
)

MS_PER_S = 1000


@dataclass(frozen=True)
class PublishKnobs:
    """运行参数页「大屏」那一组此刻的有效值。"""

    window_s: float
    reconcile_interval_s: float
    max_items: int


class Sessions(Protocol):
    """开一个短事务的最小面。"""

    def session(self) -> AbstractAsyncContextManager[AsyncSession]: ...


async def read_knobs(sessions: Sessions, settings: Settings) -> PublishKnobs:
    """读「大屏」那一组运行参数：覆盖行优先，没覆盖的回落到环境变量。

    Args: sessions, settings。
    """
    async with sessions.session() as session:
        values = await param_service.effective_values(
            session, settings=settings, section=SECTION_DASHBOARD
        )
    return knobs_of(
        values,
        window_ms=settings.publish_window_ms,
        reconcile_s=settings.publish_reconcile_interval_s,
        max_items=settings.publish_max_items,
        lease_ttl_s=settings.publish_lease_ttl_s,
    )


def knobs_of(
    values: dict[str, ParamValue],
    *,
    window_ms: float,
    reconcile_s: float,
    max_items: int,
    lease_ttl_s: float,
) -> PublishKnobs:
    """把有效值收敛成旋钮；形状不对的回落到给定的出厂值。

    ⚠ 窗口封顶在租约 TTL 的一半：一拍只续一次租约，窗口拖过 TTL 就是每一拍
    醒来租约都已过期、主在副本间来回换。
    Args: values, window_ms, reconcile_s, max_items, lease_ttl_s（均为出厂值）。
    """
    window = max(
        _number_or(values.get("publish_window_ms"), window_ms),
        PUBLISH_WINDOW_FLOOR_MS,
    )
    reconcile = _number_or(
        values.get("publish_reconcile_interval_s"), reconcile_s
    )
    items = int(_number_or(values.get("publish_max_items"), max_items))
    return PublishKnobs(
        window_s=min(window / MS_PER_S, lease_ttl_s / 2),
        reconcile_interval_s=reconcile if reconcile > 0 else reconcile_s,
        max_items=min(max(items, 1), PUBLISH_MAX_ITEMS_CEILING),
    )


def _number_or(raw: object, fallback: float) -> float:
    """收窄成数，不是数就回落。⚠ 布尔是 int 的子类，要单独挡掉。

    Args: raw, fallback。
    """
    if isinstance(raw, bool) or not isinstance(raw, int | float):
        return fallback
    return raw
