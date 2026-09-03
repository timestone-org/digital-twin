"""对外服务的管理面。读用 `modeling:view`，写用 `modeling:publish`。

⚠ 与 `open_models.py` 分成两个文件、两个前缀：那一份是匿名可达的，这一份不是。
混在一个路由器里，「哪些端点不要登录」在评审时就看不出来了。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.modeling.catalog import MODELING_VIEW
from platform_server.apps.modeling.deps import (
    WriteGate,
    get_publish_context,
    get_session,
    require,
)
from platform_server.apps.modeling.schemas import (
    ModelApiKeyCreateIn,
    ModelApiKeyMintedOut,
    ModelApiKeyOut,
    ModelCallStatOut,
    ModelDeploymentCreateIn,
    ModelDeploymentOut,
    ModelDeploymentUpdateIn,
)
from platform_server.apps.modeling.services import Actor, deployment_service
from platform_server.settings import API_PREFIX

deployments = APIRouter(
    prefix=f"{API_PREFIX}/modeling-deployments", tags=["modeling-deployment"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]
PublishDep = Annotated[WriteGate, Depends(get_publish_context)]


@deployments.get(
    "",
    response_model=ApiResponse[list[ModelDeploymentOut]],
    summary="对外服务列表",
)
async def list_deployments(
    session: SessionDep, _viewer: ViewDep
) -> ApiResponse[list[ModelDeploymentOut]]:
    """全部对外服务。

    Args: session, _viewer。
    """
    return ok(await deployment_service.list_deployments(session))


@deployments.post(
    "",
    response_model=ApiResponse[ModelDeploymentOut],
    status_code=status.HTTP_201_CREATED,
    summary="开一个对外服务",
)
async def create_deployment(
    payload: ModelDeploymentCreateIn,
    session: SessionDep,
    response: Response,
    write: PublishDep,
) -> ApiResponse[ModelDeploymentOut]:
    """把一个模型版本开成一个第三方可调的服务。

    Args: payload, session, response, write。
    """
    created = await deployment_service.create_deployment(
        session, payload=payload, actor=_actor(write)
    )
    response.status_code = status.HTTP_201_CREATED
    return ok(created)


@deployments.get(
    "/{deployment_id}",
    response_model=ApiResponse[ModelDeploymentOut],
    summary="对外服务详情",
)
async def get_deployment(
    deployment_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[ModelDeploymentOut]:
    """一个对外服务的详情。

    Args: deployment_id, session, _viewer。
    """
    return ok(await deployment_service.get_deployment(session, deployment_id))


@deployments.patch(
    "/{deployment_id}",
    response_model=ApiResponse[ModelDeploymentOut],
    summary="改一个对外服务",
)
async def update_deployment(
    deployment_id: uuid.UUID,
    payload: ModelDeploymentUpdateIn,
    session: SessionDep,
    _write: PublishDep,
) -> ApiResponse[ModelDeploymentOut]:
    """换版本、改配额、启停。`code` 不可改。

    Args: deployment_id, payload, session, _write。
    """
    return ok(
        await deployment_service.update_deployment(
            session, deployment_id=deployment_id, payload=payload
        )
    )


@deployments.delete(
    "/{deployment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删一个对外服务",
)
async def delete_deployment(
    deployment_id: uuid.UUID,
    session: SessionDep,
    response: Response,
    _write: PublishDep,
) -> None:
    """删掉一个对外服务，连同它的密钥与调用记录。

    Args: deployment_id, session, response, _write。
    """
    await deployment_service.delete_deployment(session, deployment_id)
    response.status_code = status.HTTP_204_NO_CONTENT


@deployments.get(
    "/{deployment_id}/api-keys",
    response_model=ApiResponse[list[ModelApiKeyOut]],
    summary="密钥列表",
)
async def list_keys(
    deployment_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[list[ModelApiKeyOut]]:
    """一个服务下的全部密钥。⚠ 回执里没有明文。

    Args: deployment_id, session, _viewer。
    """
    return ok(await deployment_service.list_keys(session, deployment_id))


@deployments.post(
    "/{deployment_id}/api-keys",
    response_model=ApiResponse[ModelApiKeyMintedOut],
    status_code=status.HTTP_201_CREATED,
    summary="铸一把密钥",
)
async def create_key(
    deployment_id: uuid.UUID,
    payload: ModelApiKeyCreateIn,
    session: SessionDep,
    response: Response,
    write: PublishDep,
) -> ApiResponse[ModelApiKeyMintedOut]:
    """铸一把新钥匙。**明文只在这个回执里出现一次。**

    Args: deployment_id, payload, session, response, write。
    """
    created = await deployment_service.create_key(
        session,
        deployment_id=deployment_id,
        payload=payload,
        actor=_actor(write),
    )
    response.status_code = status.HTTP_201_CREATED
    return ok(created)


@deployments.post(
    "/{deployment_id}/api-keys/{key_id}:revoke",
    response_model=ApiResponse[ModelApiKeyOut],
    summary="撤销一把密钥",
)
async def revoke_key(
    deployment_id: uuid.UUID,
    key_id: uuid.UUID,
    session: SessionDep,
    _write: PublishDep,
) -> ApiResponse[ModelApiKeyOut]:
    """撤销一把钥匙，立刻生效。

    Args: deployment_id, key_id, session, _write。
    """
    return ok(
        await deployment_service.revoke_key(
            session, deployment_id=deployment_id, key_id=key_id
        )
    )


@deployments.get(
    "/{deployment_id}/call-stats",
    response_model=ApiResponse[list[ModelCallStatOut]],
    summary="调用量",
)
async def call_stats(
    deployment_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[list[ModelCallStatOut]]:
    """近一个月按天的调用量与出错量。

    Args: deployment_id, session, _viewer。
    """
    return ok(await deployment_service.daily_stats(session, deployment_id))


def _actor(write: WriteGate) -> Actor:
    return Actor(user_id=str(write.caller.user_id), name=write.caller.username)
