"""内部端点：只在集群网内可达，边缘对 `/internal/` 一律 deny。

采集计划挂在这里而不是对外前缀下，因为它的调用方是 collector-server 这个服务
本身，不是任何一个人。认证用服务级密钥（逐字 `compare_digest`），**未配置即
拒绝**——fail-closed（api-contract §8）。
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import ApiResponse, ok
from platform_server.apps.collect.deps import (
    get_session,
    require_service_key,
)
from platform_server.apps.collect.schemas import CollectPlanOut
from platform_server.apps.collect.services import plan_service
from platform_server.settings import INTERNAL_PREFIX

router = APIRouter(
    prefix=INTERNAL_PREFIX,
    tags=["internal"],
    dependencies=[Depends(require_service_key)],
    include_in_schema=False,
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "/collect-plan",
    response_model=ApiResponse[CollectPlanOut],
    summary="全量采集计划",
)
async def read_collect_plan(
    session: SessionDep,
) -> ApiResponse[CollectPlanOut]:
    """给 collector 拉全量计划。带内容摘要版本号。

    ⚠ 只有全量、没有增量：增量消息丢一条就永久错位，而错位的采集会写出看似
    正常的错误历史（ADR-0001）。collector 按 `version` 判断要不要重新收敛。

    Args: session。
    """
    return ok(await plan_service.build_plan(session))
