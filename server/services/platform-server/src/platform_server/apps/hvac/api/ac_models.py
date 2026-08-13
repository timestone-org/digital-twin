"""达标时长模型面：建、看、改、删、重训与试算。读 `ac:view`，写 `ac:manage`。

⚠ 建模与 `:retrain` 只入队：训练跑几十秒，放进请求路径就是必然超时的 HTTP
调用；入队的事务由 service 自己提交，投递排在提交之后。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, CursorPage, CursorParams, cursor_params, ok
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.deps import (
    Dispatcher,
    get_caller,
    get_dispatcher,
    get_session,
    require,
)
from platform_server.apps.hvac.modeling.gating import reliability
from platform_server.apps.hvac.schemas import (
    AcModelCreateIn,
    AcModelOut,
    AcModelPatchIn,
    ModelPredictionOut,
    PredictIn,
    PredictOut,
)
from platform_server.apps.hvac.services import (
    ac_model_query,
    ac_model_service,
)
from platform_server.apps.hvac.services.ac_startup_query import parse_filters
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=API_PREFIX, tags=["ac-models"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CursorDep = Annotated[CursorParams, Depends(cursor_params)]
DispatchDep = Annotated[Dispatcher, Depends(get_dispatcher)]
CallerDep = Annotated[CallerContext, Depends(get_caller)]
ViewDep = Annotated[CallerContext, Depends(require(AC_VIEW))]
ManageDep = Annotated[CallerContext, Depends(require(AC_MANAGE))]


@router.get(
    "/ac-models",
    response_model=ApiResponse[list[AcModelOut]],
    summary="模型列表",
)
async def list_ac_models(
    session: SessionDep,
    _viewer: ViewDep,
    room_id: Annotated[uuid.UUID | None, Query()] = None,
) -> ApiResponse[list[AcModelOut]]:
    """全部模型（可按房间过滤），带过期提示位。

    Args: session, _viewer, room_id。
    """
    return ok(await _present_many(session, room_id=room_id))


@router.post(
    "/ac-models",
    response_model=ApiResponse[AcModelOut],
    status_code=status.HTTP_202_ACCEPTED,
    summary="建模并入队训练",
)
async def create_ac_model(
    payload: AcModelCreateIn,
    session: SessionDep,
    dispatcher: DispatchDep,
    caller: CallerDep,
    _manager: ManageDep,
) -> ApiResponse[AcModelOut]:
    """建一个模型并排进训练队列，立刻返回。

    Args: payload, session, dispatcher, caller, _manager。
    """
    model, message = await ac_model_service.create_model(
        session, payload, created_by=caller.username
    )
    dispatcher.after_commit_training(message)
    out = await _present(session, model.id)
    return ok(out, message="训练已排队")


@router.get(
    "/ac-models/{model_id}",
    response_model=ApiResponse[AcModelOut],
    summary="模型详情",
)
async def get_ac_model(
    model_id: uuid.UUID,
    session: SessionDep,
    _viewer: ViewDep,
) -> ApiResponse[AcModelOut]:
    """一个模型的完整形态：配置、评估、出处与过期提示。

    Args: model_id, session, _viewer。
    """
    return ok(await _present(session, model_id))


@router.patch(
    "/ac-models/{model_id}",
    response_model=ApiResponse[AcModelOut],
    summary="改名、改描述或改服务组合",
)
async def patch_ac_model(
    model_id: uuid.UUID,
    payload: AcModelPatchIn,
    session: SessionDep,
    _manager: ManageDep,
) -> ApiResponse[AcModelOut]:
    """改配置。⚠ 改服务组合就地重汇总评估，不触发重训。

    Args: model_id, payload, session, _manager。
    """
    await ac_model_service.patch_model(session, model_id, payload)
    return ok(await _present(session, model_id), message="已保存")


@router.delete(
    "/ac-models/{model_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除模型",
)
async def delete_ac_model(
    model_id: uuid.UUID,
    session: SessionDep,
    _manager: ManageDep,
) -> Response:
    """删除模型与它的工件、折外预测。没有也返回 204——DELETE 必须幂等。

    Args: model_id, session, _manager。
    """
    await ac_model_service.delete_model(session, model_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/ac-models/{model_id}:retrain",
    response_model=ApiResponse[AcModelOut],
    status_code=status.HTTP_202_ACCEPTED,
    summary="重训（入队）",
)
async def retrain_ac_model(
    model_id: uuid.UUID,
    session: SessionDep,
    dispatcher: DispatchDep,
    _manager: ManageDep,
) -> ApiResponse[AcModelOut]:
    """按当前配置与当前批次重训，立刻返回。

    Args: model_id, session, dispatcher, _manager。
    """
    _, message = await ac_model_service.request_retrain(session, model_id)
    dispatcher.after_commit_training(message)
    return ok(await _present(session, model_id), message="重训已排队")


@router.get(
    "/ac-models/{model_id}/predictions",
    response_model=ApiResponse[CursorPage[ModelPredictionOut]],
    summary="折外预测与实际的逐条对比",
)
async def list_ac_model_predictions(
    model_id: uuid.UUID,
    session: SessionDep,
    cursor: CursorDep,
    _viewer: ViewDep,
    running_set: Annotated[str | None, Query()] = None,
) -> ApiResponse[CursorPage[ModelPredictionOut]]:
    """历史每一条可用事件的折外预测与实际，最新的在前，可按组合过滤。

    Args: model_id, session, cursor, _viewer, running_set。
    """
    await ac_model_service.get_model(session, model_id)
    filters = parse_filters(None, running_set)
    page = await ac_model_query.prediction_page(
        session,
        model_id=model_id,
        running_set=filters.running_set,
        cursor=cursor,
    )
    return ok(page)


@router.post(
    "/ac-models/{model_id}:predict",
    response_model=ApiResponse[PredictOut],
    summary="试算：给一个假想开机条件出三分位达标时长",
)
async def predict_with_ac_model(
    model_id: uuid.UUID,
    payload: PredictIn,
    session: SessionDep,
    _viewer: ViewDep,
) -> ApiResponse[PredictOut]:
    """纯计算的 what-if，不训练也不碰外库。读权限即可试算。

    Args: model_id, payload, session, _viewer。
    """
    found = await ac_model_service.predict(session, model_id, payload)
    return ok(_predict_out(found))


async def _present(session: AsyncSession, model_id: uuid.UUID) -> AcModelOut:
    """取一个模型的对外形态（含过期提示位）。

    Args: session, model_id。
    """
    model, room, workshop = await ac_model_service.get_with_refs(
        session, model_id
    )
    stale = await ac_model_query.stale_flags(session, [model])
    return ac_model_query.to_model_out(
        model, room, workshop, is_batch_stale=stale[model.id]
    )


async def _present_many(
    session: AsyncSession, *, room_id: uuid.UUID | None
) -> list[AcModelOut]:
    """一批模型的对外形态（含过期提示位）。

    Args: session, room_id。
    """
    rows = await ac_model_service.list_with_refs(session, room_id=room_id)
    stale = await ac_model_query.stale_flags(
        session, [model for model, _, _ in rows]
    )
    return [
        ac_model_query.to_model_out(
            model, room, workshop, is_batch_stale=stale[model.id]
        )
        for model, room, workshop in rows
    ]


def _predict_out(found: ac_model_service.PredictResult) -> PredictOut:
    """试算结果 → 对外模型，可靠性按区间宽度分档。

    Args: found。
    """
    width = found.p90 - found.p10
    return PredictOut(
        p10=found.p10,
        p50=found.p50,
        p90=found.p90,
        interval_width_minutes=width,
        reliability=reliability(width),
        is_in_serving_sets=found.is_in_serving_sets,
        is_dedicated=found.is_dedicated,
        trained_at=found.trained_at,
    )
