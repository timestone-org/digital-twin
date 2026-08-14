"""整屏模板库。事务边界在这一层：crud 不提交，api 不写业务。

模板是一份**与来源脱钩**的整屏包：建模板时把源屏导出成包、把缩略图拷一份，
此后源屏改版不回溯到模板，删掉源屏也不影响模板。实例化就是把这份包按导入面
同一套规则写成一张新大屏，故指不到点位的绑定同样逐条回报而不是静默丢掉。
"""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.web import Page, PageParams
from platform_server.apps.dashboard.crud.template import template_crud
from platform_server.apps.dashboard.crud.thumbnail import thumbnail_crud
from platform_server.apps.dashboard.errors import TemplateNotFound
from platform_server.apps.dashboard.models import DashboardTemplate
from platform_server.apps.dashboard.schemas.template import (
    TemplateCreateIn,
    TemplateInstantiateIn,
    TemplateOut,
    TemplateSummaryOut,
)
from platform_server.apps.dashboard.schemas.transfer import (
    DashboardExportOut,
    DashboardImportOut,
)
from platform_server.apps.dashboard.services.dashboard_service import (
    require_dashboard,
)
from platform_server.apps.dashboard.services.transfer_service import (
    export_dashboard,
    import_dashboard,
)
from platform_server.apps.dashboard.services.validation import (
    ValidationContext,
)

_logger = get_logger("platform.dashboard.template")


async def list_templates(
    session: AsyncSession, *, category: str | None, page: PageParams
) -> Page[TemplateSummaryOut]:
    """模板列表。整包不进这条查询，也不进出参。

    Args: session, category, page。
    """
    rows, total = await template_crud.list_page(
        session,
        statement=template_crud.build_query(category=category),
        offset=page.offset,
        limit=page.size,
    )
    return Page[TemplateSummaryOut](
        items=[to_summary_out(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_template(
    session: AsyncSession, *, template_id: uuid.UUID
) -> TemplateOut:
    """模板详情，带整包。

    Args: session, template_id。
    """
    return to_template_out(await require_template(session, template_id))


async def create_template(
    session: AsyncSession, *, payload: TemplateCreateIn
) -> TemplateOut:
    """把一张大屏另存为模板：现导出一份包，再把源屏的缩略图拷进来。

    Args: session, payload。
    """
    source = await require_dashboard(session, payload.source_dashboard_id)
    document = await export_dashboard(session, dashboard_id=source.id)
    stored = await thumbnail_crud.get(session, source.id)
    template = DashboardTemplate(
        name=payload.name,
        description=payload.description,
        category=payload.category,
        thumbnail=None if stored is None else stored.data,
        payload_json=package_json(document),
        source_project_id=source.project_id,
    )
    template_crud.add(session, template)
    await session.flush()
    _logger.info(
        "dashboard_template_created",
        "模板已创建",
        template_id=str(template.id),
        source_dashboard_id=str(source.id),
    )
    return to_template_out(template)


async def delete_template(
    session: AsyncSession, *, template_id: uuid.UUID
) -> None:
    """删模板。已经按它建出来的大屏不受影响——包在建屏那一刻就落地了。

    Args: session, template_id。
    """
    template = await require_template(session, template_id)
    _logger.info(
        "dashboard_template_deleted", "模板已删除", template_id=str(template.id)
    )
    await template_crud.delete(session, template)


async def instantiate_template(
    session: AsyncSession,
    *,
    template_id: uuid.UUID,
    payload: TemplateInstantiateIn,
    context: ValidationContext,
) -> DashboardImportOut:
    """按模板在目标项目下建一张新大屏。

    ⚠ 缺省名取**模板名**而不是包里那个名字：包里存的是另存为那一刻源屏的名字，
    而用户在模板墙上认的是模板名。
    Args: session, template_id, payload, context。
    """
    template = await require_template(session, template_id)
    created = await import_dashboard(
        session,
        project_id=payload.target_project_id,
        payload=package_of(template),
        context=context,
        new_name=payload.name or template.name,
    )
    _logger.info(
        "dashboard_template_instantiated",
        "模板已实例化",
        template_id=str(template.id),
        dashboard_id=str(created.id),
        unresolved_count=len(created.unresolved_bindings),
    )
    return created


async def require_template(
    session: AsyncSession, template_id: uuid.UUID
) -> DashboardTemplate:
    """取模板，取不到即 404。

    Args: session, template_id。
    """
    template = await template_crud.get(session, template_id)
    if template is None:
        raise TemplateNotFound("模板不存在")
    return template


def package_json(document: DashboardExportOut) -> dict[str, Any]:
    """整屏包在 JSONB 里的形态。

    ⚠ 必须 `by_alias`：节点几何在包里叫 `x`/`y`/`w`/`h`，按字段名存下来的包
    读出去就与 `:export` 的产出对不上，而两边都不会报错。
    Args: document。
    """
    return document.model_dump(mode="json", by_alias=True)


def package_of(template: DashboardTemplate) -> DashboardExportOut:
    """模板里存着的那份整屏包。

    Args: template。
    """
    return DashboardExportOut.model_validate(template.payload_json)


def to_summary_out(template: DashboardTemplate) -> TemplateSummaryOut:
    """模板墙上的一条。

    Args: template。
    """
    return TemplateSummaryOut.model_validate(template)


def to_template_out(template: DashboardTemplate) -> TemplateOut:
    """模板详情的对外形态，带整包。

    Args: template。
    """
    return TemplateOut(
        id=template.id,
        name=template.name,
        description=template.description,
        category=template.category,
        thumbnail=template.thumbnail,
        source_project_id=template.source_project_id,
        created_at=template.created_at,
        updated_at=template.updated_at,
        payload=package_of(template),
    )
