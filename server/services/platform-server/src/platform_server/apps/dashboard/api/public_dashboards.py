"""按公开令牌匿名读一张已发布的大屏。

⚠ 本服务唯一不挂鉴权依赖的对外路由。匿名可达性由边缘的免认证 location 保证，
闸 1 里那条空码规则只负责让带着令牌来的已登录用户
不被兜底规则要走 `ac:view`。
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import ApiResponse, ok
from platform_server.apps.dashboard.deps import get_session
from platform_server.apps.dashboard.schemas.share import PublicDashboardOut
from platform_server.apps.dashboard.services import share_service
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/public-dashboards", tags=["dashboard"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "/{public_token}",
    response_model=ApiResponse[PublicDashboardOut],
    summary="按公开令牌读大屏",
)
async def read_public_dashboard(
    public_token: str, session: SessionDep
) -> ApiResponse[PublicDashboardOut]:
    """读一张已发布的大屏。令牌无效或已被撤回一律 404。

    Args: public_token, session。
    """
    return ok(
        await share_service.get_public_dashboard(
            session, public_token=public_token
        )
    )
