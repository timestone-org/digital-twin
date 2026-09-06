"""Word 直传凭证与异步导入入口。"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import ApiResponse, ok
from platform_server.apps.report.deps import ReportManageGate, manage_gate
from platform_server.apps.report.schemas.jobs import (
    ImportStartIn,
    ImportTicketIn,
    ImportTicketOut,
    RenderOut,
)
from platform_server.apps.report.services.import_service import (
    upload_ticket,
    validate_source,
)
from platform_server.apps.report.services.render_service import (
    RenderContext,
    start_import,
)
from platform_server.deps import (
    get_session,
)
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/report-templates", tags=["report-import"]
)
ManageDep = Annotated[ReportManageGate, Depends(manage_gate)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.post(":upload-ticket", response_model=ApiResponse[ImportTicketOut])
async def issue_ticket(
    payload: ImportTicketIn, gate: ManageDep
) -> ApiResponse[ImportTicketOut]:
    return ok(
        await upload_ticket(gate.store, str(gate.caller.user_id), payload)
    )


@router.post(":import", status_code=202, response_model=ApiResponse[RenderOut])
async def import_document(
    payload: ImportStartIn,
    session: SessionDep,
    gate: ManageDep,
) -> ApiResponse[RenderOut]:
    actor = str(gate.caller.user_id)
    await validate_source(gate.store, actor, payload.object_key)
    context = RenderContext(
        actor=actor,
        stream=gate.stream,
        timezone=gate.timezone,
        idempotency_key=gate.idempotency_key,
    )
    return ok(await start_import(session, payload.object_key, context))
