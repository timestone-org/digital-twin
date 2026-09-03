"""模型对外推理面。**这是本模块唯一匿名可达的前缀。**

⚠ 匿名可达性由边缘那条免认证 location 保证（`docker/nginx/nginx.conf.template`
里的 `location ^~ /api/v1/platform/open-models/`），照 `public-dashboards` 的
先例。授权凭据是 `X-Api-Key` 头，由本服务自己核对
（docs/MODELING_PLATFORM_DESIGN.md D14）。

⚠ 本文件里**每一个**路由函数都必须以 `CallDep` 开头——那个依赖就是鉴权本身。
漏一个的表现是那条路径整个匿名开放，而它不会报任何错。有一条契约测试扫描本
文件逐个核对。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import ApiResponse, ok
from platform_server.apps.modeling.deps import (
    OpenModelDeps,
    get_open_model_deps,
    get_session,
)
from platform_server.apps.modeling.schemas import (
    OpenModelPredictIn,
    OpenModelPredictOut,
)
from platform_server.apps.modeling.services import open_model_service
from platform_server.apps.modeling.services.open_model_service import (
    ResolvedCall,
)
from platform_server.settings import API_PREFIX

open_models = APIRouter(
    prefix=f"{API_PREFIX}/open-models", tags=["modeling-open"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
DepsDep = Annotated[OpenModelDeps, Depends(get_open_model_deps)]
# 密钥头。⚠ 只从头里取，绝不接受查询参数——URL 会进访问日志、进浏览器历史、
# 进代理的缓存键（防线 ⑪）
ApiKeyHeader = Annotated[str, Header(alias="X-Api-Key")]


async def resolve(
    code: str,
    session: SessionDep,
    deps: DepsDep,
    x_api_key: ApiKeyHeader = "",
) -> ResolvedCall:
    """认一次调用并计一次配额。本前缀下每个端点的第一件事。

    Args: code, session, deps, x_api_key。
    """
    resolved = await open_model_service.resolve_call(
        session, code=code, presented_key=x_api_key
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
