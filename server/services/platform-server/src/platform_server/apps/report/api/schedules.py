"""定时规则的 HTTP 管理面。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.report.catalog import REPORT_VIEW
from platform_server.apps.report.deps import schedule_gate
from platform_server.apps.report.schemas.jobs import (
    ScheduleCreateIn,
    ScheduleOut,
    ScheduleUpdateIn,
)
from platform_server.apps.report.services import schedule_service
from platform_server.deps import WriteGate, get_session, require
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/report-schedules", tags=["report-schedule"]
)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(REPORT_VIEW))]
ScheduleDep = Annotated[WriteGate, Depends(schedule_gate)]


@router.get("", response_model=ApiResponse[Page[ScheduleOut]])
async def list_schedules(
    session: SessionDep, page: PageDep, _viewer: ViewDep
) -> ApiResponse[Page[ScheduleOut]]:
    return ok(await schedule_service.list_schedules(session, page))


@router.post("", status_code=201, response_model=ApiResponse[ScheduleOut])
async def create_schedule(
    payload: ScheduleCreateIn,
    session: SessionDep,
    gate: ScheduleDep,
    response: Response,
) -> ApiResponse[ScheduleOut]:
    result = await gate.run_once(
        endpoint="report-schedules:create",
        model=ScheduleOut,
        action=lambda: schedule_service.create_schedule(
            session, payload, str(gate.caller.user_id)
        ),
    )
    response.headers["Location"] = f"{API_PREFIX}/report-schedules/{result.id}"
    return ok(result)


@router.put("/{schedule_id}", response_model=ApiResponse[ScheduleOut])
async def update_schedule(
    schedule_id: uuid.UUID,
    payload: ScheduleUpdateIn,
    session: SessionDep,
    gate: ScheduleDep,
) -> ApiResponse[ScheduleOut]:
    return ok(
        await schedule_service.update_schedule(
            session, schedule_id, payload, str(gate.caller.user_id)
        )
    )


@router.delete("/{schedule_id}", status_code=204)
async def delete_schedule(
    schedule_id: uuid.UUID, session: SessionDep, gate: ScheduleDep
) -> Response:
    await schedule_service.delete_schedule(
        session, schedule_id, str(gate.caller.user_id)
    )
    return Response(status_code=204)
