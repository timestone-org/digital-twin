"""模型版本与公式绑定面。读用 `modeling:view`，写用 `modeling:publish`。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.objectstore import ObjectStore
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.modeling.catalog import (
    DATASET_MANAGE,
    MODELING_PUBLISH,
    MODELING_VIEW,
)
from platform_server.apps.modeling.deps import (
    WriteGate,
    get_object_store,
    get_publish_context,
    get_session,
    require,
)
from platform_server.apps.modeling.schemas import (
    ModelBindingCreateIn,
    ModelBindingImpactOut,
    ModelBindingOut,
    ModelBindingUpdateIn,
    ModelFormulaOut,
    ModelFormulaRegisterIn,
    ModelVersionCreateIn,
    ModelVersionOut,
    ModelVersionSummaryOut,
)
from platform_server.apps.modeling.services import Actor, model_service
from platform_server.apps.modeling.services.binding_service import (
    BindingDraft,
    delete_binding,
)
from platform_server.settings import API_PREFIX

versions = APIRouter(
    prefix=f"{API_PREFIX}/modeling-model-versions", tags=["modeling-model"]
)
bindings = APIRouter(
    prefix=f"{API_PREFIX}/modeling-bindings", tags=["modeling-binding"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]
PublishDep = Annotated[WriteGate, Depends(get_publish_context)]
StoreDep = Annotated[ObjectStore, Depends(get_object_store)]
# ⚠ 一键注册要**同时**要两个码：绝不能让发布权顺带获得往公式库写的能力，
# 那两个码分家正是因为爆炸半径不同（D17）
RegisterDep = Annotated[
    CallerContext, Depends(require(MODELING_PUBLISH, DATASET_MANAGE))
]


@versions.get(
    "",
    response_model=ApiResponse[Page[ModelVersionSummaryOut]],
    summary="模型版本列表",
)
async def list_versions(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    pipeline_id: uuid.UUID | None = None,
) -> ApiResponse[Page[ModelVersionSummaryOut]]:
    """分页列出模型版本，可按流水线筛。

    Args: session, page, _viewer, pipeline_id。
    """
    return ok(
        await model_service.list_versions(
            session, pipeline_id=pipeline_id, page=page
        )
    )


@versions.post(
    "",
    response_model=ApiResponse[ModelVersionOut],
    status_code=status.HTTP_201_CREATED,
    summary="发布模型版本",
)
async def publish_version(
    payload: ModelVersionCreateIn,
    session: SessionDep,
    response: Response,
    write: PublishDep,
    store: StoreDep,
) -> ApiResponse[ModelVersionOut]:
    """把一次成功运行发布成一个不可变的版本。

    Args: payload, session, response, write, store。
    """
    created = await model_service.publish_version(
        session, payload=payload, actor=_actor(write), store=store
    )
    response.status_code = status.HTTP_201_CREATED
    return ok(created)


@versions.post(
    "/{version_id}:register-formula",
    response_model=ApiResponse[ModelFormulaOut],
    status_code=status.HTTP_201_CREATED,
    summary="注册为公式",
)
async def register_formula(
    version_id: uuid.UUID,
    payload: ModelFormulaRegisterIn,
    session: SessionDep,
    response: Response,
    caller: RegisterDep,
) -> ApiResponse[ModelFormulaOut]:
    """一步建库公式条目 + 建绑定。形参从模型签名生成，顺序天然对齐。

    Args: version_id, payload, session, response, caller。
    """
    created = await model_service.register_formula(
        session,
        version_id=version_id,
        fx_code=payload.fx_code,
        actor=Actor(user_id=str(caller.user_id), name=caller.username),
    )
    response.status_code = status.HTTP_201_CREATED
    return ok(created)


@versions.get(
    "/{version_id}",
    response_model=ApiResponse[ModelVersionOut],
    summary="模型版本详情",
)
async def get_version(
    version_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[ModelVersionOut]:
    """详情，含指标与指纹。

    Args: version_id, session, _viewer。
    """
    return ok(await model_service.get_version(session, version_id))


@versions.delete(
    "/{version_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="退役模型版本",
)
async def retire_version(
    version_id: uuid.UUID, session: SessionDep, _write: PublishDep
) -> Response:
    """退役。还有绑定指着它时 409。

    Args: version_id, session, _write。
    """
    await model_service.retire_version(session, version_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@bindings.get(
    "", response_model=ApiResponse[list[ModelBindingOut]], summary="绑定列表"
)
async def list_bindings(
    session: SessionDep, _viewer: ViewDep
) -> ApiResponse[list[ModelBindingOut]]:
    """全部绑定，逐条现算孤儿标志。

    Args: session, _viewer。
    """
    return ok(await model_service.list_bindings(session))


@bindings.post(
    "",
    response_model=ApiResponse[ModelBindingOut],
    status_code=status.HTTP_201_CREATED,
    summary="绑定模型到公式条目",
)
async def create_binding(
    payload: ModelBindingCreateIn,
    session: SessionDep,
    response: Response,
    write: PublishDep,
) -> ApiResponse[ModelBindingOut]:
    """按位置把形参映射到特征列上。

    Args: payload, session, response, write。
    """
    created = await model_service.bind(
        session,
        draft=BindingDraft(
            fx_code=payload.fx_code,
            model_version_id=payload.model_version_id,
        ),
        actor=_actor(write),
    )
    response.status_code = status.HTTP_201_CREATED
    return ok(created)


@bindings.patch(
    "/{binding_id}",
    response_model=ApiResponse[ModelBindingImpactOut],
    summary="换版本或启停",
)
async def update_binding(
    binding_id: uuid.UUID,
    payload: ModelBindingUpdateIn,
    session: SessionDep,
    _write: PublishDep,
) -> ApiResponse[ModelBindingImpactOut]:
    """回执带影响面：哪些台账列会跟着变。重算由用户在台账页显式发起。

    Args: binding_id, payload, session, _write。
    """
    return ok(
        await model_service.update_binding(
            session, binding_id=binding_id, payload=payload
        )
    )


@bindings.delete(
    "/{binding_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除绑定",
)
async def remove_binding(
    binding_id: uuid.UUID, session: SessionDep, _write: PublishDep
) -> Response:
    """删绑定。之后那一列变空并给「模型未绑定」。

    Args: binding_id, session, _write。
    """
    await delete_binding(session, binding_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _actor(write: WriteGate) -> Actor:
    """写这一笔的人。

    Args: write。
    """
    return Actor(user_id=str(write.caller.user_id), name=write.caller.username)
