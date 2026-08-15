"""预测下发的配置面：绑点位、看绑成了什么样、解绑。

读 `ac:view`，写 `ac:manage`。口径见 docs/AC_PUBLISH_DESIGN.md §8。

⚠ 保存是 `PUT` 整份不是 `PATCH` 逐字段：绑定是一组必须同时成立的东西——换了
实例，底下每一个节点 id 都得跟着换。逐字段改会让中间态出现「节点属于旧实例」，
而那个中间态每分钟往现场写一次。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.deps import (
    get_node_writer,
    get_session,
    require,
)
from platform_server.apps.hvac.schemas import (
    PublicationOut,
    PublicationPutIn,
    SetBindingOut,
)
from platform_server.apps.hvac.services import ac_publication_service
from platform_server.apps.hvac.services.ac_publication_service import (
    PublicationView,
)
from platform_server.opcua import NodeWriter
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=API_PREFIX, tags=["ac-publications"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
NodesDep = Annotated[NodeWriter, Depends(get_node_writer)]
ViewDep = Annotated[CallerContext, Depends(require(AC_VIEW))]
ManageDep = Annotated[CallerContext, Depends(require(AC_MANAGE))]

_PUBLICATION = "/ac-models/{model_id}/publication"


@router.get(
    _PUBLICATION,
    response_model=ApiResponse[PublicationOut],
    summary="预测下发配置",
)
async def read_publication(
    model_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[PublicationOut]:
    """这个模型往哪台实例、哪些点位下发，以及上一拍的去向。

    Args: model_id, session, _viewer。
    """
    view = await ac_publication_service.get_view(session, model_id)
    return ok(_present(view))


@router.put(
    _PUBLICATION,
    response_model=ApiResponse[PublicationOut],
    summary="保存预测下发配置",
)
async def put_publication(
    model_id: uuid.UUID,
    payload: PublicationPutIn,
    session: SessionDep,
    nodes: NodesDep,
    _manager: ManageDep,
) -> ApiResponse[PublicationOut]:
    """整份保存。保存前会问一遍 opcua-server：节点还在不在、类型对不对。

    Args: model_id, payload, session, nodes, _manager。
    """
    return ok(
        _present(
            await ac_publication_service.put_publication(
                session, nodes, model_id=model_id, payload=payload
            )
        )
    )


@router.delete(
    _PUBLICATION,
    status_code=status.HTTP_204_NO_CONTENT,
    summary="解绑预测下发",
)
async def delete_publication(
    model_id: uuid.UUID, session: SessionDep, _manager: ManageDep
) -> Response:
    """解绑。没配过也算成功——DELETE 必须幂等。

    ⚠ 只删配置，**不动点位上此刻的值**：现场读到的还是最后一次写进去的那个数。

    Args: model_id, session, _manager。
    """
    await ac_publication_service.delete_publication(session, model_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _present(view: PublicationView) -> PublicationOut:
    """发布配置 → 对外模型。

    Args: view。
    """
    row = view.publication
    serving = set(view.serving_keys)
    return PublicationOut(
        model_id=row.model_id,
        opcua_instance_id=row.opcua_instance_id,
        recommendation_node_id=row.recommendation_node_id,
        recommendation_identifier=row.recommendation_identifier,
        is_enabled=row.is_enabled,
        is_fully_bound=view.is_fully_bound,
        unbound_set_keys=view.unbound_set_keys,
        set_bindings=[
            SetBindingOut(
                set_key=binding.set_key,
                node_id=binding.node_id,
                identifier=binding.identifier,
                is_serving=binding.set_key in serving,
            )
            for binding in view.bindings
        ],
        last_published_at=row.last_published_at,
        last_status=row.last_status,
        last_error=row.last_error,
    )
