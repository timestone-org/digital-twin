"""卡片样式库：一整套观感存成一条，全站共享，可套回任意同类型节点。

读面走 `dashboard:view`，写面走 `dashboard:manage`——与整屏模板同级，理由也同：
往全站共享的资产库里加一条，与改自己那张屏不是同一类操作。**不新增权限码**。
建样式产生新资源，故它支持 `Idempotency-Key`。
"""

import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.dashboard.catalog import DASHBOARD_VIEW
from platform_server.apps.dashboard.deps import (
    WriteContext,
    get_manage_context,
    get_session,
    require,
)
from platform_server.apps.dashboard.schemas import (
    CardStyleCreateIn,
    CardStyleOut,
    CardStyleUpdateIn,
)
from platform_server.apps.dashboard.services import card_style_service
from platform_server.settings import API_PREFIX

CARD_STYLES_URL = f"{API_PREFIX}/card-styles"

router = APIRouter(prefix=CARD_STYLES_URL, tags=["card-style"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(DASHBOARD_VIEW))]
ManageDep = Annotated[WriteContext, Depends(get_manage_context)]


def create_action(
    session: AsyncSession, write: WriteContext, payload: CardStyleCreateIn
) -> Callable[[], Awaitable[CardStyleOut]]:
    """把这一次新建包成一个动作，交给幂等闸只跑一遍。

    Args: session, write, payload。
    """
    return lambda: card_style_service.create_card_style(
        session, payload=payload, catalog=write.validation.catalog
    )


@router.get(
    "", response_model=ApiResponse[Page[CardStyleOut]], summary="卡片样式列表"
)
async def list_card_styles(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    module_type: str | None = None,
) -> ApiResponse[Page[CardStyleOut]]:
    """分页列出样式，可按模块类型过滤，缺省按更新时刻降序。

    Args: session, page, _viewer, module_type。
    """
    return ok(
        await card_style_service.list_card_styles(
            session, module_type=module_type, page=page
        )
    )


@router.post(
    "",
    response_model=ApiResponse[CardStyleOut],
    status_code=status.HTTP_201_CREATED,
    summary="新建卡片样式",
)
async def create_card_style(
    payload: CardStyleCreateIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[CardStyleOut]:
    """存一条样式。支持 `Idempotency-Key`。

    Args: payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_card_style",
        model=CardStyleOut,
        action=create_action(session, write, payload),
    )
    response.headers["Location"] = f"{CARD_STYLES_URL}/{created.id}"
    return ok(created, message="卡片样式已创建")


@router.get(
    "/{style_id}",
    response_model=ApiResponse[CardStyleOut],
    summary="卡片样式详情",
)
async def read_card_style(
    style_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[CardStyleOut]:
    """样式详情，外壳与内芯的完整取值。

    Args: style_id, session, _viewer。
    """
    return ok(
        await card_style_service.get_card_style(session, style_id=style_id)
    )


@router.patch(
    "/{style_id}",
    response_model=ApiResponse[CardStyleOut],
    summary="更新卡片样式",
)
async def update_card_style(
    style_id: uuid.UUID,
    payload: CardStyleUpdateIn,
    session: SessionDep,
    write: ManageDep,
) -> ApiResponse[CardStyleOut]:
    """改样式。⚠ 入参收不了 `module_type`，换类型请复制一条。

    Args: style_id, payload, session, write。
    """
    updated = await card_style_service.update_card_style(
        session,
        style_id=style_id,
        payload=payload,
        catalog=write.validation.catalog,
    )
    return ok(updated, message="卡片样式已更新")


@router.delete(
    "/{style_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除卡片样式",
)
async def delete_card_style(
    style_id: uuid.UUID, session: SessionDep, _write: ManageDep
) -> Response:
    """删样式。已经套过它的节点不受影响。

    Args: style_id, session, _write。
    """
    await card_style_service.delete_card_style(session, style_id=style_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
