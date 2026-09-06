"""模板试算的服务入口。"""

import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.report.errors import ReportPreviewTimeout
from platform_server.apps.report.schemas.preview import PreviewIn, PreviewOut
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.metrics import PreviewContext
from platform_server.apps.report.services.preview import preview
from platform_server.apps.report.services.template_service import (
    require_template,
)


async def preview_template(
    session: AsyncSession,
    template_id: uuid.UUID,
    payload: PreviewIn,
    timezone: str,
    budget_s: float = 20,
) -> PreviewOut:
    """试算模板。Args: session, template_id, payload, timezone。"""
    try:
        async with asyncio.timeout(budget_s):
            return await _preview(session, template_id, payload, timezone)
    except TimeoutError as error:
        raise ReportPreviewTimeout(
            "试算超过时限，请缩小时间窗或减少指标"
        ) from error


async def _preview(
    session: AsyncSession,
    template_id: uuid.UUID,
    payload: PreviewIn,
    timezone: str,
) -> PreviewOut:
    row = await require_template(session, template_id)
    body = payload.draft or TemplateBody.model_validate(row.body_json)
    if payload.granularity:
        body.granularity = payload.granularity
    return await preview(
        session,
        PreviewContext(template=body, period=payload.period, timezone=timezone),
    )
