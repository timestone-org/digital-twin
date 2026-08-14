"""逐条绑定的写入面。与整树替换共用同一套校验与同一套 id 保持逻辑。"""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.utils.ids import uuid7
from platform_server.apps.dashboard.crud import binding_crud
from platform_server.apps.dashboard.errors import (
    BindingNotFound,
    FieldKeyTaken,
)
from platform_server.apps.dashboard.models import DashboardBinding
from platform_server.apps.dashboard.schemas import (
    BindingCreateIn,
    BindingOut,
    BindingUpdateIn,
)
from platform_server.apps.dashboard.services.changes import given_changes
from platform_server.apps.dashboard.services.dashboard_service import (
    bump_version,
    require_dashboard,
)
from platform_server.apps.dashboard.services.drafts import binding_draft_of
from platform_server.apps.dashboard.services.node_service import require_node
from platform_server.apps.dashboard.services.presenters import to_binding_out
from platform_server.apps.dashboard.services.state import (
    DashboardState,
    binding_drafts,
    load_state,
    node_drafts,
)
from platform_server.apps.dashboard.services.validation import (
    ValidationContext,
    collect_issues,
    raise_if_invalid,
)

_logger = get_logger("platform.dashboard.binding")


async def list_bindings(
    session: AsyncSession, *, node_id: uuid.UUID
) -> list[BindingOut]:
    """一个节点的全部绑定，顺序钉死在 `(field_key, id)`。

    Args: session, node_id。
    """
    node = await require_node(session, node_id)
    rows = await binding_crud.list_by_nodes(session, [node.id])
    return [to_binding_out(item) for item in rows]


async def create_binding(
    session: AsyncSession,
    *,
    node_id: uuid.UUID,
    payload: BindingCreateIn,
    context: ValidationContext,
) -> BindingOut:
    """新增一条绑定。id 一经创建永不改变。

    Args: session, node_id, payload, context。
    """
    node = await require_node(session, node_id)
    dashboard = await require_dashboard(session, node.dashboard_id)
    state = await load_state(session, dashboard.id)
    binding = DashboardBinding(
        id=payload.id or uuid7(),
        node_id=node.id,
        field_key=payload.field_key,
        source_kind=payload.source_kind,
        node_key=payload.node_key,
        static_value_json=payload.static_value_json,
        compute_json=payload.compute_json,
        detail_json=payload.detail_json,
        transform_json=payload.transform_json,
    )
    await _check(state=state, binding=binding, context=context)
    binding_crud.add(session, binding)
    bump_version(dashboard)
    await _flush(session)
    _logger.info(
        "dashboard_binding_created", "绑定已创建", binding_id=str(binding.id)
    )
    return to_binding_out(binding)


async def update_binding(
    session: AsyncSession,
    *,
    binding_id: uuid.UUID,
    payload: BindingUpdateIn,
    context: ValidationContext,
) -> BindingOut:
    """改绑定。换槽要删了重建——id 是实时推送的关联键。

    Args: session, binding_id, payload, context。
    """
    binding = await require_binding(session, binding_id)
    node = await require_node(session, binding.node_id)
    dashboard = await require_dashboard(session, node.dashboard_id)
    state = await load_state(session, dashboard.id)
    binding_crud.apply_changes(binding, given_changes(payload))
    await _check(state=state, binding=binding, context=context)
    bump_version(dashboard)
    await _flush(session)
    _logger.info(
        "dashboard_binding_updated", "绑定已更新", binding_id=str(binding.id)
    )
    return to_binding_out(binding)


async def delete_binding(
    session: AsyncSession, *, binding_id: uuid.UUID
) -> None:
    """删绑定。

    Args: session, binding_id。
    """
    binding = await require_binding(session, binding_id)
    node = await require_node(session, binding.node_id)
    dashboard = await require_dashboard(session, node.dashboard_id)
    bump_version(dashboard)
    _logger.info(
        "dashboard_binding_deleted", "绑定已删除", binding_id=str(binding.id)
    )
    await binding_crud.delete(session, binding)


async def require_binding(
    session: AsyncSession, binding_id: uuid.UUID
) -> DashboardBinding:
    """取绑定，取不到即 404。

    Args: session, binding_id。
    """
    binding = await binding_crud.get(session, binding_id)
    if binding is None:
        raise BindingNotFound("绑定不存在")
    return binding


async def _check(
    *,
    state: DashboardState,
    binding: DashboardBinding,
    context: ValidationContext,
) -> None:
    """把改动后的这个节点的绑定过一遍校验。

    Args: state, binding, context。
    """
    draft = binding_draft_of(binding, field_path="")
    siblings = [
        item
        for item in state.bindings_of(binding.node_id)
        if item.id != binding.id
    ]
    raise_if_invalid(
        await collect_issues(
            nodes=node_drafts(state.nodes),
            bindings=binding_drafts(siblings, replaced=draft),
            context=context,
        )
    )


async def _flush(session: AsyncSession) -> None:
    try:
        await session.flush()
    except IntegrityError as error:
        raise FieldKeyTaken("这个绑定槽已经绑过了") from error
