"""工作流的一条定时训练规则。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.modeling.catalog import MODELING_RUN, MODELING_VIEW
from platform_server.apps.modeling.deps import get_session, require
from platform_server.apps.modeling.schemas.schedule import (
    ModelingScheduleIn,
    ModelingScheduleOut,
)
from platform_server.apps.modeling.services import schedule_service
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/modeling-pipelines", tags=["modeling-schedule"]
)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]
RunDep = Annotated[CallerContext, Depends(require(MODELING_RUN))]


@router.get(
    "/{pipeline_id}/schedule", response_model=ApiResponse[ModelingScheduleOut]
)
async def get_schedule(
    pipeline_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[ModelingScheduleOut]:
    return ok(await schedule_service.get_schedule(session, pipeline_id))


@router.put(
    "/{pipeline_id}/schedule", response_model=ApiResponse[ModelingScheduleOut]
)
async def save_schedule(
    pipeline_id: uuid.UUID,
    payload: ModelingScheduleIn,
    session: SessionDep,
    caller: RunDep,
) -> ApiResponse[ModelingScheduleOut]:
    return ok(
        await schedule_service.save_schedule(
            session, pipeline_id, payload, caller
        )
    )
