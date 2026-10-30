"""模型对外调用面，使用账号鉴权和部署配额；见 ADR-0062。"""

from dataclasses import replace
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.logging import get_logger
from lib.web import ApiResponse, ok
from lib.web.response import error_payload
from platform_server.apps.modeling.catalog import MODELING_VIEW
from platform_server.apps.modeling.command_deps import get_operator_identity
from platform_server.apps.modeling.command_errors import ModelingRateLimited
from platform_server.apps.modeling.deps import (
    OpenModelDeps,
    get_open_model_deps,
    get_session,
    require,
)
from platform_server.apps.modeling.schemas import (
    OpenModelPredictIn,
    OpenModelPredictOut,
)
from platform_server.apps.modeling.schemas.calculation import (
    OpenModelCalculateIn,
    OpenModelCalculateOut,
)
from platform_server.apps.modeling.schemas.detection import (
    OpenModelDetectIn,
    OpenModelDetectOut,
)
from platform_server.apps.modeling.services import (
    calculation,
    detection,
    open_model_service,
)
from platform_server.apps.modeling.services.open_model_service import (
    ResolvedCall,
)
from platform_server.settings import API_PREFIX

open_models = APIRouter(
    prefix=f"{API_PREFIX}/open-models",
    tags=["modeling-open"],
    dependencies=[
        Depends(
            HTTPBearer(
                auto_error=False,
                scheme_name="UserApiKey",
                description=(
                    "用户 APIKey（dtk_…），" "账号需具有 modeling:view 权限。"
                ),
            )
        )
    ],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
DepsDep = Annotated[OpenModelDeps, Depends(get_open_model_deps)]
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]
_logger = get_logger("platform.modeling.open")


async def handle_model_rate_limit(
    _request: Request, error: Exception
) -> JSONResponse:
    if not isinstance(error, ModelingRateLimited):
        raise error
    _logger.warning(
        "modeling_call_rate_limited", error.message, code=error.code
    )
    return JSONResponse(
        status_code=error.http_status,
        content=error_payload(code=error.code, message=error.message),
        headers={"Retry-After": str(error.retry_after_s)},
    )


async def resolve(
    code: str,
    viewer: ViewDep,
    session: SessionDep,
    deps: DepsDep,
    request: Request,
) -> ResolvedCall:
    """检查部署状态并计入当前账号的配额。Args: code, viewer, session, deps。"""
    identity = get_operator_identity(request, viewer)
    resolved = await open_model_service.resolve_call(
        session, code=code, user_id=viewer.user_id
    )
    resolved = replace(
        resolved, external_operator_id=identity.external_operator_id
    )
    return await open_model_service.guard_rate(deps, resolved)


CallDep = Annotated[ResolvedCall, Depends(resolve)]


@open_models.get(
    "/{code}",
    response_model=ApiResponse[dict[str, object]],
    summary="模型签名",
)
async def get_signature(call: CallDep) -> ApiResponse[dict[str, object]]:
    """这个模型要哪些参数、给出什么。

    ⚠ 回的是**剥掉训练统计**的那一份：训练区间的具体数值是训练数据的分布，
    属于内部信息（D8）。
    Args: call。
    """
    return ok(open_model_service.public_signature(call.version))


@open_models.post(
    "/{code}:predict",
    response_model=ApiResponse[OpenModelPredictOut],
    summary="预测",
)
async def predict(
    payload: OpenModelPredictIn,
    session: SessionDep,
    deps: DepsDep,
    call: CallDep,
) -> ApiResponse[OpenModelPredictOut]:
    """算一批数。

    Args: payload, session, deps, call。
    """
    return ok(
        await open_model_service.predict_and_record(
            session, deps=deps, resolved=call, payload=payload
        )
    )


@open_models.post(
    "/{code}:detect",
    response_model=ApiResponse[OpenModelDetectOut],
    summary="设备异常检测",
)
async def detect(
    payload: OpenModelDetectIn,
    session: SessionDep,
    deps: DepsDep,
    call: CallDep,
) -> ApiResponse[OpenModelDetectOut]:
    """按模型阈值判断一批设备实时输入。Args: payload, session, deps, call。"""
    return ok(
        await detection.detect(
            session, deps=deps, resolved=call, payload=payload
        )
    )


@open_models.post(
    "/{code}:calculate",
    response_model=ApiResponse[OpenModelCalculateOut],
    summary="规则计算",
)
async def calculate(
    payload: OpenModelCalculateIn,
    session: SessionDep,
    deps: DepsDep,
    call: CallDep,
) -> ApiResponse[OpenModelCalculateOut]:
    """返回按模型规则计算的逐行明细。Args: payload, session, deps, call。"""
    return ok(
        await calculation.calculate_and_record(
            session, deps=deps, resolved=call, payload=payload
        )
    )
