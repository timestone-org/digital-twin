"""每台空调的季节达标配置。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.deps import (
    get_hvac_timezone,
    get_session,
    require,
)
from platform_server.apps.hvac.schemas.ac_compliance import (
    CompliancePolicyIn,
    CompliancePolicyOut,
)
from platform_server.apps.hvac.services import ac_compliance_service
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=API_PREFIX, tags=["ac-data"])
SessionDep = Annotated[AsyncSession, Depends(get_session)]
TimezoneDep = Annotated[str, Depends(get_hvac_timezone)]
ViewDep = Annotated[CallerContext, Depends(require(AC_VIEW))]
ManageDep = Annotated[CallerContext, Depends(require(AC_MANAGE))]


@router.get(
    "/ac-units/{ac_unit_id}/compliance-policies",
    response_model=ApiResponse[CompliancePolicyOut],
    summary="季节达标配置",
)
async def get_compliance_policy(
    ac_unit_id: uuid.UUID,
    session: SessionDep,
    timezone: TimezoneDep,
    _viewer: ViewDep,
) -> ApiResponse[CompliancePolicyOut]:
    return ok(
        await ac_compliance_service.read_policy(
            session, ac_unit_id, timezone=timezone
        )
    )


@router.put(
    "/ac-units/{ac_unit_id}/compliance-policies",
    response_model=ApiResponse[CompliancePolicyOut],
    summary="保存两季达标配置",
)
async def put_compliance_policy(
    ac_unit_id: uuid.UUID,
    payload: CompliancePolicyIn,
    session: SessionDep,
    timezone: TimezoneDep,
    _manager: ManageDep,
) -> ApiResponse[CompliancePolicyOut]:
    return ok(
        await ac_compliance_service.put_policy(
            session, ac_unit_id, payload, timezone=timezone
        )
    )
