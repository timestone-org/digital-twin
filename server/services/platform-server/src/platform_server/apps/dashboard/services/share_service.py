"""大屏的发布面：换发公开令牌、撤回公开、按令牌匿名取一张屏。

⚠ 每次发布都换一个新令牌。不换的话「取消发布再发布」会让旧链接重新生效，
「撤回」于是只是界面上的一句话。
"""

import secrets
import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.dashboard.errors import DashboardNotPublished
from platform_server.apps.dashboard.models import (
    Dashboard,
    DashboardBinding,
    DashboardNode,
)
from platform_server.apps.dashboard.schemas.share import (
    DashboardShareOut,
    PublicBindingOut,
    PublicDashboardOut,
    PublicNodeOut,
)
from platform_server.apps.dashboard.services.dashboard_service import (
    require_dashboard,
)
from platform_server.apps.dashboard.services.state import load_state

_logger = get_logger("platform.dashboard.share")

# 令牌熵：32 字节经 urlsafe base64 得 43 个字符
TOKEN_BYTES = 32
# 外观袋里存联动规则的那一段。⚠ 键名与前端的
# `web/app/src/features/dashboard/interactionRules.ts` 各写一份，改名要一起改
INTERACTIONS_CHROME_KEY = "interactions"
# 令牌长度上限。超长的一律当作查不到，而不是让它去打一次库
MAX_TOKEN_CHARS = 128


def new_public_token() -> str:
    """换发一个公开令牌。"""
    return secrets.token_urlsafe(TOKEN_BYTES)


def is_wellformed_token(public_token: str) -> bool:
    """令牌形状值不值得去打一次库。

    Args: public_token。
    """
    return bool(public_token) and len(public_token) <= MAX_TOKEN_CHARS


async def publish_dashboard(
    session: AsyncSession, *, dashboard_id: uuid.UUID
) -> DashboardShareOut:
    """发布一张大屏，换发公开令牌并让旧链接立即失效。

    Args: session, dashboard_id。
    """
    dashboard = await require_dashboard(session, dashboard_id)
    dashboard.is_public = True
    dashboard.public_token = new_public_token()
    await session.flush()
    # 审计：发布是授权面的操作，记录发在业务事务内，回滚时它一并不作数
    _logger.info(
        "dashboard_published",
        "大屏已发布",
        dashboard_id=str(dashboard.id),
        project_id=str(dashboard.project_id),
    )
    return to_share_out(dashboard)


async def unpublish_dashboard(
    session: AsyncSession, *, dashboard_id: uuid.UUID
) -> DashboardShareOut:
    """撤回公开：置回不公开并清掉令牌，公开链接随即 404。

    Args: session, dashboard_id。
    """
    dashboard = await require_dashboard(session, dashboard_id)
    dashboard.is_public = False
    dashboard.public_token = None
    await session.flush()
    _logger.info(
        "dashboard_unpublished",
        "大屏已取消发布",
        dashboard_id=str(dashboard.id),
        project_id=str(dashboard.project_id),
    )
    return to_share_out(dashboard)


async def get_public_dashboard(
    session: AsyncSession, *, public_token: str
) -> PublicDashboardOut:
    """按公开令牌读一张已发布的大屏。

    ⚠ 「没这个令牌」与「已取消发布」共用同一个 404：分开回会让人拿旧链接
    试出「这张屏确实存在过」。
    Args: session, public_token。
    """
    dashboard = await find_by_public_token(session, public_token)
    if dashboard is None:
        raise DashboardNotPublished("公开链接无效或已被撤回")
    state = await load_state(session, dashboard.id)
    return to_public_dashboard_out(
        dashboard,
        nodes=[
            to_public_node_out(node, bindings=state.bindings_of(node.id))
            for node in state.nodes
        ],
    )


async def find_by_public_token(
    session: AsyncSession, public_token: str
) -> Dashboard | None:
    """按令牌取一张**仍在公开中**的大屏，取不到给 None。

    Args: session, public_token。
    """
    if not is_wellformed_token(public_token):
        return None
    rows = await session.execute(
        select(Dashboard).where(
            Dashboard.is_public.is_(True),
            Dashboard.public_token == public_token,
        )
    )
    return rows.scalars().one_or_none()


def to_public_chrome(chrome_json: dict[str, Any]) -> dict[str, Any]:
    """公开面的外观袋：联动规则整段不下发，其余原样。

    ⚠ 跨屏跳转的规则里存着**别的大屏的 id**，而公开面不回任何能定位它在库里
    位置的信息（ADR-0014）。公开页也确实不跑联动——它压根不装联动引擎，
    下发这一段只是让那些 id 白白出一趟门。
    ⚠ 只剥这一个键：外观袋其余的段是渲染要用的，剥多了公开页就跟登录态不一样。
    Args: chrome_json。
    """
    return {
        key: value
        for key, value in chrome_json.items()
        if key != INTERACTIONS_CHROME_KEY
    }


def to_share_out(dashboard: Dashboard) -> DashboardShareOut:
    """发布状态的对外形态。

    Args: dashboard。
    """
    return DashboardShareOut(
        dashboard_id=dashboard.id,
        is_public=dashboard.is_public,
        public_token=dashboard.public_token,
        updated_at=dashboard.updated_at,
    )


def to_public_binding_out(binding: DashboardBinding) -> PublicBindingOut:
    """公开面的一条绑定。

    Args: binding。
    """
    return PublicBindingOut.model_validate(binding)


def to_public_node_out(
    node: DashboardNode, *, bindings: Sequence[DashboardBinding]
) -> PublicNodeOut:
    """公开面的一个节点。绑定由调用方按 `(field_key, id)` 备好。

    Args: node, bindings。
    """
    return PublicNodeOut(
        id=node.id,
        parent_id=node.parent_id,
        client_key=node.client_key,
        module_type=node.module_type,
        x_px=node.x_px,
        y_px=node.y_px,
        width_px=node.width_px,
        height_px=node.height_px,
        z_index=node.z_index,
        is_visible=node.is_visible,
        config_json=node.config_json,
        bindings=[to_public_binding_out(item) for item in bindings],
    )


def to_public_dashboard_out(
    dashboard: Dashboard, *, nodes: Sequence[PublicNodeOut]
) -> PublicDashboardOut:
    """公开面的一张大屏。`nodes` 是扁平数组，树由 `parent_id` 重建。

    Args: dashboard, nodes。
    """
    return PublicDashboardOut(
        name=dashboard.name,
        description=dashboard.description,
        design_width=dashboard.design_width,
        design_height=dashboard.design_height,
        schema_version=dashboard.schema_version,
        theme_json=dashboard.theme_json,
        chrome_json=to_public_chrome(dashboard.chrome_json),
        updated_at=dashboard.updated_at,
        nodes=list(nodes),
    )
