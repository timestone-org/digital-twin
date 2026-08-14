"""整屏模板库：一份导出包一个模板，可实例化到任意项目。

读面走 `dashboard:view`；建、删与实例化都归 `dashboard:manage`——模板是跨项目
共享的资产，改一张自己的屏与往全局模板墙上加一条不是同一类操作。建与实例化
产生新资源，故两条都支持 `Idempotency-Key`。
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
from platform_server.apps.dashboard.schemas.template import (
    TemplateCreateIn,
    TemplateInstantiateIn,
    TemplateOut,
    TemplateSummaryOut,
)
from platform_server.apps.dashboard.schemas.transfer import DashboardImportOut
from platform_server.apps.dashboard.services import template_service
from platform_server.settings import API_PREFIX

TEMPLATES_URL = f"{API_PREFIX}/dashboard-templates"

router = APIRouter(prefix=TEMPLATES_URL, tags=["dashboard"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(DASHBOARD_VIEW))]
ManageDep = Annotated[WriteContext, Depends(get_manage_context)]


def create_action(
    session: AsyncSession, payload: TemplateCreateIn
) -> Callable[[], Awaitable[TemplateOut]]:
    """把这一次另存为包成一个动作，交给幂等闸只跑一遍。

    Args: session, payload。
    """
    return lambda: template_service.create_template(session, payload=payload)


def instantiate_action(
    session: AsyncSession,
    write: WriteContext,
    template_id: uuid.UUID,
    payload: TemplateInstantiateIn,
) -> Callable[[], Awaitable[DashboardImportOut]]:
    """把这一次实例化包成一个动作，交给幂等闸只跑一遍。

    Args: session, write, template_id, payload。
    """
    return lambda: template_service.instantiate_template(
        session,
        template_id=template_id,
        payload=payload,
        context=write.validation,
    )


@router.get(
    "",
    response_model=ApiResponse[Page[TemplateSummaryOut]],
    summary="模板列表",
)
async def list_templates(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    category: str | None = None,
) -> ApiResponse[Page[TemplateSummaryOut]]:
    """分页列出模板，可按分类过滤。列表项不带整包。

    Args: session, page, _viewer, category。
    """
    return ok(
        await template_service.list_templates(
            session, category=category, page=page
        )
    )


@router.post(
    "",
    response_model=ApiResponse[TemplateOut],
    status_code=status.HTTP_201_CREATED,
    summary="另存为模板",
)
async def create_template(
    payload: TemplateCreateIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[TemplateOut]:
    """把一张大屏另存为模板。支持 `Idempotency-Key`。

    Args: payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_dashboard_template",
        model=TemplateOut,
        action=create_action(session, payload),
    )
    response.headers["Location"] = f"{TEMPLATES_URL}/{created.id}"
    return ok(created, message="模板已创建")


@router.get(
    "/{template_id}",
    response_model=ApiResponse[TemplateOut],
    summary="模板详情",
)
async def read_template(
    template_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[TemplateOut]:
    """模板详情，带整包。

    Args: template_id, session, _viewer。
    """
    return ok(
        await template_service.get_template(session, template_id=template_id)
    )


@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除模板",
)
async def delete_template(
    template_id: uuid.UUID, session: SessionDep, _write: ManageDep
) -> Response:
    """删模板。按它建出来的大屏不受影响。

    Args: template_id, session, _write。
    """
    await template_service.delete_template(session, template_id=template_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{template_id}:instantiate",
    response_model=ApiResponse[DashboardImportOut],
    status_code=status.HTTP_201_CREATED,
    summary="从模板实例化大屏",
)
async def instantiate_template(
    template_id: uuid.UUID,
    payload: TemplateInstantiateIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[DashboardImportOut]:
    """按模板在目标项目下建一张新大屏。支持 `Idempotency-Key`。

    Args: template_id, payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="instantiate_dashboard_template",
        model=DashboardImportOut,
        action=instantiate_action(session, write, template_id, payload),
    )
    response.headers["Location"] = f"{API_PREFIX}/dashboards/{created.id}"
    return ok(created, message="模板已实例化")
