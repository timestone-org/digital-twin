"""模板事务边界、版本保护与审计。"""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import current_traceparent, parse_traceparent
from lib.web import Page, PageParams
from platform_server.apps.report.crud import templates
from platform_server.apps.report.errors import (
    ReportConflict,
    ReportInvalid,
    ReportNotFound,
)
from platform_server.apps.report.models import ReportAudit, ReportTemplate
from platform_server.apps.report.schemas.template import (
    ReportTemplateCreateIn,
    ReportTemplateOut,
    ReportTemplateSummaryOut,
    TemplateBody,
    TemplateUpdateIn,
)
from platform_server.apps.report.services.document import validate_template


def to_summary(row: ReportTemplate) -> ReportTemplateSummaryOut:
    return ReportTemplateSummaryOut.model_validate(row)


def to_output(row: ReportTemplate) -> ReportTemplateOut:
    body = TemplateBody.model_validate(row.body_json)
    return ReportTemplateOut(
        **to_summary(row).model_dump(),
        doc_json=body.doc_json,
        metrics=body.metrics,
        page_json=body.page_json,
    )


def require_valid(body: TemplateBody) -> None:
    result = validate_template(body)
    if not result.is_valid:
        raise ReportInvalid(
            "；".join(
                issue.message for issue in result.issues if issue.is_blocking
            )
        )


async def require_template(
    session: AsyncSession, template_id: uuid.UUID
) -> ReportTemplate:
    row = await templates.get(session, template_id)
    if row is None:
        raise ReportNotFound("报告模板不存在")
    return row


async def read_template(
    session: AsyncSession, template_id: uuid.UUID
) -> ReportTemplateOut:
    return to_output(await require_template(session, template_id))


async def list_templates(
    session: AsyncSession, page: PageParams
) -> Page[ReportTemplateSummaryOut]:
    rows, total = await templates.page(session, page.offset, page.size)
    return Page[ReportTemplateSummaryOut](
        items=[to_summary(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def create_template(
    session: AsyncSession, payload: ReportTemplateCreateIn, actor: str
) -> ReportTemplateOut:
    """创建模板并在同事务写审计。Args: session, payload, actor。"""
    body = TemplateBody.model_validate(payload.model_dump(exclude={"code"}))
    require_valid(body)
    row = ReportTemplate(code=payload.code, **_columns(body))
    try:
        async with session.begin_nested():
            await templates.add(session, row)
    except IntegrityError as error:
        raise ReportConflict("模板编码已被占用") from error
    record_audit(
        session, actor, "template_created", row.id, (None, body.model_dump())
    )
    return to_output(row)


async def update_template(
    session: AsyncSession,
    template_id: uuid.UUID,
    payload: TemplateUpdateIn,
    actor: str,
) -> ReportTemplateOut:
    """版本保护保存。Args: session, template_id, payload, actor。"""
    row = await require_template(session, template_id)
    before = dict(row.body_json)
    body = TemplateBody.model_validate(
        payload.model_dump(exclude={"expected_version"})
    )
    require_valid(body)
    if not await templates.save_version(
        session, template_id, payload.expected_version, _columns(body)
    ):
        raise ReportConflict("模板已被其他人修改，请重新加载后再保存")
    await session.refresh(row)
    record_audit(
        session, actor, "template_updated", row.id, (before, body.model_dump())
    )
    return to_output(row)


async def delete_template(
    session: AsyncSession, template_id: uuid.UUID, actor: str
) -> None:
    row = await templates.get(session, template_id)
    if row is None:
        return
    if await templates.has_children(session, template_id):
        raise ReportConflict("模板仍有定时规则或生成记录，请停用模板以保留历史")
    record_audit(
        session, actor, "template_deleted", row.id, (row.body_json, None)
    )
    await templates.delete(session, row)


def _columns(body: TemplateBody) -> dict[str, object]:
    return {
        "name": body.name,
        "description": body.description,
        "granularity": body.granularity,
        "is_enabled": body.is_enabled,
        "body_json": body.model_dump(),
    }


def record_audit(
    session: AsyncSession,
    actor: str,
    action: str,
    target: uuid.UUID,
    changes: tuple[dict[str, object] | None, dict[str, object] | None],
) -> None:
    """记录报告操作审计。Args: session, actor, action, target, changes。"""
    templates.audit(
        session,
        ReportAudit(
            actor_id=actor,
            action=action,
            target_id=target,
            trace_id=parse_traceparent(current_traceparent()) or "",
            before_json=changes[0],
            after_json=changes[1],
        ),
    )
