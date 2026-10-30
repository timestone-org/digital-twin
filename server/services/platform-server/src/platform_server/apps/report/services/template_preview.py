"""模板试算的服务入口。"""

import asyncio
import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.report.errors import ReportPreviewTimeout
from platform_server.apps.report.schemas.api_source import ReportApiConnection
from platform_server.apps.report.schemas.preview import PreviewIn, PreviewOut
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.api_source import fetch_api_sources
from platform_server.apps.report.services.document import validate_template
from platform_server.apps.report.services.metrics import PreviewContext
from platform_server.apps.report.services.preview import preview
from platform_server.apps.report.services.template_service import (
    require_template,
)

PREVIEW_BUDGET_S = 20


async def preview_template(
    session: AsyncSession,
    template_id: uuid.UUID,
    payload: PreviewIn,
    timezone: str,
    connections: Sequence[ReportApiConnection] = (),
) -> PreviewOut:
    """试算模板。Args: session, template_id, payload, timezone。"""
    try:
        async with asyncio.timeout(PREVIEW_BUDGET_S):
            return await _preview(
                session, template_id, payload, timezone, connections
            )
    except TimeoutError as error:
        raise ReportPreviewTimeout(
            "试算超过时限，请缩小时间窗或减少指标"
        ) from error


async def _preview(
    session: AsyncSession,
    template_id: uuid.UUID,
    payload: PreviewIn,
    timezone: str,
    connections: Sequence[ReportApiConnection],
) -> PreviewOut:
    row = await require_template(session, template_id)
    body = payload.draft or TemplateBody.model_validate(row.body_json)
    if payload.granularity:
        body.granularity = payload.granularity
    await session.commit()
    context = PreviewContext(
        template=body, period=payload.period, timezone=timezone
    )
    if validate_template(body).is_valid:
        context.api_data = await fetch_api_sources(
            body.api_sources,
            connections,
            payload.period,
            body.granularity,
            timezone,
        )
    return await preview(
        session,
        context,
    )
