"""大屏的复制、导出与导入。事务边界在这一层：crud 不提交，api 不写业务。

⚠ 导出包里不许出现任何 id，父子关系一律走 `client_key`；源库里没有
`client_key` 的节点由导出侧按它在确定序里的位置补一个稳定值。带 id 的包导回
同一个库，会让「导入」变成悄悄改掉源屏。
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import FieldError
from lib.logging import get_logger
from lib.utils.ids import uuid7
from platform_server.apps.dashboard.crud import (
    binding_crud,
    dashboard_crud,
    node_crud,
)
from platform_server.apps.dashboard.errors import (
    ExportPayloadInvalid,
    ImportTargetMismatch,
)
from platform_server.apps.dashboard.models import (
    Dashboard,
    DashboardBinding,
    DashboardNode,
)
from platform_server.apps.dashboard.schemas import DashboardOut
from platform_server.apps.dashboard.schemas.transfer import (
    COPY_NAME_SUFFIX,
    DashboardExportIn,
    DashboardExportOut,
    DashboardImportOut,
    DuplicateDashboardIn,
    ExportBindingIn,
    ExportNodeIn,
    UnresolvedBindingOut,
)
from platform_server.apps.dashboard.services.dashboard_service import (
    bump_version,
    present_dashboard,
    require_dashboard,
)
from platform_server.apps.dashboard.services.drafts import (
    BindingDraft,
    NodeDraft,
)
from platform_server.apps.dashboard.services.project_service import (
    require_project,
)
from platform_server.apps.dashboard.services.state import load_state
from platform_server.apps.dashboard.services.validation import (
    ValidationContext,
    collect_issues,
    raise_if_invalid,
)

_logger = get_logger("platform.dashboard.transfer")

# 与 schemas/common.py 的 `Label` 上限同口径
MAX_NAME_LENGTH = 64
# 导出侧补键的前缀
DERIVED_KEY_PREFIX = "node"
# 唯一一条「登记但不拦」的校验问题：指向本部署没有的点位的绑定照常入库，
# 静默丢掉它们会让用户以为导进来的是一张能用的屏
TOLERATED_ISSUE_CODE = "point_not_found"


@dataclass(frozen=True)
class PlannedBinding:
    """导入计划里的一条绑定。`field_path` 决定错误指到包的哪一处。"""

    binding_id: uuid.UUID
    entry: ExportBindingIn
    field_path: str


@dataclass(frozen=True)
class PlannedNode:
    """导入计划里的一个节点，id 与父 id 都已经发好。"""

    node_id: uuid.UUID
    parent_id: uuid.UUID | None
    entry: ExportNodeIn
    field_path: str
    bindings: list[PlannedBinding]


async def export_dashboard(
    session: AsyncSession, *, dashboard_id: uuid.UUID
) -> DashboardExportOut:
    """导出一张大屏成可移植文档。包里不含任何 id。

    Args: session, dashboard_id。
    """
    dashboard = await require_dashboard(session, dashboard_id)
    state = await load_state(session, dashboard.id)
    keys = derived_client_keys(state.nodes)
    return DashboardExportOut(
        schema_version=dashboard.schema_version,
        name=dashboard.name,
        description=dashboard.description,
        design_width=dashboard.design_width,
        design_height=dashboard.design_height,
        theme_json=dashboard.theme_json,
        chrome_json=dashboard.chrome_json,
        nodes=[
            _to_export_node(
                node,
                client_key=keys[node.id],
                parent_key=(
                    None if node.parent_id is None else keys[node.parent_id]
                ),
                bindings=state.bindings_of(node.id),
            )
            for node in state.nodes
        ],
    )


# ⚠ 形参数超出上限：这个签名被端点契约钉死，模板面（PR3）按它直接调用
async def import_dashboard(  # noqa: PLR0913
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    payload: DashboardExportIn,
    context: ValidationContext,
    new_name: str | None = None,
    target_dashboard_id: uuid.UUID | None = None,
) -> DashboardImportOut:
    """把一份文档导入成一张大屏；给了 `target_dashboard_id` 就覆盖它。

    Args: session, project_id, payload, context, new_name,
    target_dashboard_id。
    """
    project = await require_project(session, project_id)
    target = await _overwrite_target(
        session, project_id=project.id, target_dashboard_id=target_dashboard_id
    )
    planned = plan_import(payload)
    unresolved = await _unresolved_bindings(planned, context=context)
    dashboard = await _prepare_dashboard(
        session,
        project_id=project.id,
        payload=payload,
        target=target,
        name=new_name,
    )
    await _write(session, dashboard=dashboard, planned=planned)
    _logger.info(
        "dashboard_imported",
        "大屏已导入",
        dashboard_id=str(dashboard.id),
        node_count=len(planned),
        unresolved_count=len(unresolved),
    )
    return _with_unresolved(
        await present_dashboard(session, dashboard), unresolved
    )


async def duplicate_dashboard(
    session: AsyncSession,
    *,
    dashboard_id: uuid.UUID,
    payload: DuplicateDashboardIn,
    context: ValidationContext,
) -> DashboardOut:
    """复制一张大屏。缺省落回源项目，缺省名是源名加后缀。

    Args: session, dashboard_id, payload, context。
    """
    source = await require_dashboard(session, dashboard_id)
    document = await export_dashboard(session, dashboard_id=source.id)
    copied = await import_dashboard(
        session,
        project_id=payload.target_project_id or source.project_id,
        payload=document,
        context=context,
        new_name=payload.new_name or copy_name(source.name),
    )
    _logger.info(
        "dashboard_duplicated",
        "大屏已复制",
        dashboard_id=str(copied.id),
        source_dashboard_id=str(source.id),
    )
    return copied


def copy_name(name: str) -> str:
    """复制出来的屏的缺省名。

    ⚠ 必须先截断再拼后缀：源名顶到 `Label` 上限时，直接拼出来的名字过不了
    长度校验，而那一下抛在出参构造处，对外表现是 500 而不是 400。
    Args: name。
    """
    room = MAX_NAME_LENGTH - len(COPY_NAME_SUFFIX)
    return f"{name[:room]}{COPY_NAME_SUFFIX}"


def derived_client_keys(
    nodes: Sequence[DashboardNode],
) -> dict[uuid.UUID, str]:
    """每个节点在导出包里的 `client_key`：有就用它，没有按位置补一个。

    ⚠ 位置取自 `(parent_id, z_index, id)` 这个确定序，同一张没改过的大屏导
    两次逐字相同；补出来的键还要避开包里已有的键，否则父子引用会指错节点。
    Args: nodes。
    """
    taken = {node.client_key for node in nodes if node.client_key is not None}
    keys: dict[uuid.UUID, str] = {}
    for index, node in enumerate(nodes):
        keys[node.id] = node.client_key or _free_key(index, taken)
    return keys


def plan_import(payload: DashboardExportIn) -> list[PlannedNode]:
    """给包里每个节点与绑定发一套新 id，并把 `parent_key` 解成 `parent_id`。

    Args: payload。
    """
    node_ids = _claim_node_ids(payload.nodes)
    return [
        PlannedNode(
            node_id=node_ids[entry.client_key],
            parent_id=_parent_id(entry, node_ids, f"nodes[{index}]"),
            entry=entry,
            field_path=f"nodes[{index}]",
            bindings=_plan_bindings(entry, f"nodes[{index}]"),
        )
        for index, entry in enumerate(payload.nodes)
    ]


def in_parent_first_order(planned: Sequence[PlannedNode]) -> list[PlannedNode]:
    """按「父在子前」排一遍，新节点才插得进自引用外键。

    ⚠ 成环已由校验拦在前面，故这里必然排得出来；排不出的残余按原序追加，
    不静默丢节点。
    Args: planned。
    """
    ordered: list[PlannedNode] = []
    placed: set[uuid.UUID] = set()
    pending = list(planned)
    while pending:
        ready = [
            item
            for item in pending
            if item.parent_id is None or item.parent_id in placed
        ]
        if not ready:
            ordered.extend(pending)
            break
        ordered.extend(ready)
        placed.update(item.node_id for item in ready)
        pending = [item for item in pending if item.node_id not in placed]
    return ordered


def node_drafts(planned: Sequence[PlannedNode]) -> list[NodeDraft]:
    """导入计划的节点校验形态。

    Args: planned。
    """
    return [
        NodeDraft(
            node_id=item.node_id,
            parent_id=item.parent_id,
            client_key=item.entry.client_key,
            module_type=item.entry.module_type,
            field_path=item.field_path,
        )
        for item in planned
    ]


def binding_drafts(planned: Sequence[PlannedNode]) -> list[BindingDraft]:
    """导入计划的绑定校验形态。

    Args: planned。
    """
    return [
        BindingDraft(
            node_id=item.node_id,
            field_key=binding.entry.field_key,
            source_kind=binding.entry.source_kind,
            field_path=binding.field_path,
            node_key=binding.entry.node_key,
            compute_json=binding.entry.compute_json,
            detail_json=binding.entry.detail_json,
            static_value_json=binding.entry.static_value_json,
            has_static_value=binding.entry.static_value_json is not None,
        )
        for item in planned
        for binding in item.bindings
    ]


def point_key_of(entry: ExportBindingIn) -> str:
    """这条绑定指向的点位身份，指不到就是空串。

    ⚠ 与 `binding_rules` 的取法同口径：`archive` 的点位写在取数说明里，
    只看 `node_key` 会把历史绑定报成「没指点位」。
    Args: entry。
    """
    if entry.source_kind == "archive":
        raw = (entry.detail_json or {}).get("node_key")
        return raw if isinstance(raw, str) else ""
    return entry.node_key or ""


def _free_key(index: int, taken: set[str]) -> str:
    candidate = f"{DERIVED_KEY_PREFIX}-{index}"
    serial = 2
    while candidate in taken:
        candidate = f"{DERIVED_KEY_PREFIX}-{index}.{serial}"
        serial += 1
    taken.add(candidate)
    return candidate


def _to_export_node(
    node: DashboardNode,
    *,
    client_key: str,
    parent_key: str | None,
    bindings: Sequence[DashboardBinding],
) -> ExportNodeIn:
    """一个节点在导出包里的形态。

    Args: node, client_key, parent_key, bindings。
    """
    return ExportNodeIn(
        client_key=client_key,
        parent_key=parent_key,
        module_type=node.module_type,
        x_px=node.x_px,
        y_px=node.y_px,
        width_px=node.width_px,
        height_px=node.height_px,
        z_index=node.z_index,
        is_visible=node.is_visible,
        config_json=node.config_json,
        bindings=[_to_export_binding(item) for item in bindings],
    )


def _to_export_binding(binding: DashboardBinding) -> ExportBindingIn:
    # ⚠ 走 `model_validate` 而不是逐字段构造：库里 `source_kind` 是 Text 加
    # CHECK，取值集合由 source_kinds.py 与 `SourceKind` 同口径守着
    return ExportBindingIn.model_validate(binding, from_attributes=True)


def _claim_node_ids(nodes: Sequence[ExportNodeIn]) -> dict[str, uuid.UUID]:
    """包里每个 `client_key` 领一个新节点 id；键在包里撞了即拒。

    Args: nodes。
    """
    claimed: dict[str, uuid.UUID] = {}
    for index, entry in enumerate(nodes):
        if entry.client_key in claimed:
            raise ExportPayloadInvalid(
                "导入包里有重复的 client_key",
                details=(
                    FieldError(
                        field=f"nodes[{index}].client_key",
                        code="client_key_duplicated",
                        message=f"包里已经有这个键：{entry.client_key}",
                    ),
                ),
            )
        claimed[entry.client_key] = uuid7()
    return claimed


def _parent_id(
    entry: ExportNodeIn, node_ids: Mapping[str, uuid.UUID], field_path: str
) -> uuid.UUID | None:
    if entry.parent_key is None:
        return None
    parent = node_ids.get(entry.parent_key)
    if parent is None:
        raise ExportPayloadInvalid(
            "导入包里的父节点指向了包外的 client_key",
            details=(
                FieldError(
                    field=f"{field_path}.parent_key",
                    code="parent_key_not_found",
                    message=f"包里没有这个键：{entry.parent_key}",
                ),
            ),
        )
    return parent


def _plan_bindings(
    entry: ExportNodeIn, field_path: str
) -> list[PlannedBinding]:
    return [
        PlannedBinding(
            binding_id=uuid7(),
            entry=item,
            field_path=f"{field_path}.bindings[{index}]",
        )
        for index, item in enumerate(entry.bindings)
    ]


async def _overwrite_target(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    target_dashboard_id: uuid.UUID | None,
) -> Dashboard | None:
    """要覆盖的大屏；没给目标就是新建。目标不在这个项目下即 409。

    Args: session, project_id, target_dashboard_id。
    """
    if target_dashboard_id is None:
        return None
    dashboard = await require_dashboard(session, target_dashboard_id)
    if dashboard.project_id != project_id:
        raise ImportTargetMismatch("要覆盖的大屏不在这个项目下")
    return dashboard


async def _prepare_dashboard(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    payload: DashboardExportIn,
    target: Dashboard | None,
    name: str | None,
) -> Dashboard:
    """备好要写入的大屏：给了目标就清空它的树，否则新建一张。

    Args: session, project_id, payload, target, name。
    """
    dashboard = target
    if dashboard is None:
        dashboard = Dashboard(project_id=project_id, name=name or payload.name)
        dashboard_crud.add(session, dashboard)
    else:
        # 覆盖保留目标的 id 与名字：换名字是另一件事，得显式给 new_name
        dashboard.name = name or dashboard.name
        await _clear_nodes(session, dashboard.id)
        bump_version(dashboard)
    _apply_document(dashboard, payload)
    await session.flush()
    return dashboard


def _apply_document(dashboard: Dashboard, payload: DashboardExportIn) -> None:
    """把文档里的配置盖到大屏上。名字与项目归属不在文档里。

    Args: dashboard, payload。
    """
    dashboard.description = payload.description
    dashboard.design_width = payload.design_width
    dashboard.design_height = payload.design_height
    dashboard.theme_json = payload.theme_json
    dashboard.chrome_json = payload.chrome_json
    dashboard.schema_version = payload.schema_version


async def _clear_nodes(session: AsyncSession, dashboard_id: uuid.UUID) -> None:
    """清掉一张大屏现有的节点，绑定随级联外键一起走。

    ⚠ 必须先落盘再插新节点：`(dashboard_id, client_key)` 上有唯一约束，同一次
    flush 里旧行还在，重名的新节点当场撞键。
    Args: session, dashboard_id。
    """
    existing = await node_crud.list_by_dashboard(session, dashboard_id)
    await node_crud.delete_by_ids(session, [node.id for node in existing])
    await session.flush()


async def _write(
    session: AsyncSession,
    *,
    dashboard: Dashboard,
    planned: Sequence[PlannedNode],
) -> None:
    """写节点再写绑定。

    ⚠ 节点必须先落盘：`dashboard_nodes` 的自引用外键让 SQLAlchemy 的表排序
    失效，同一次 flush 里绑定会抢在节点前面插，当场撞外键。
    Args: session, dashboard, planned。
    """
    for item in in_parent_first_order(planned):
        node_crud.add(
            session,
            DashboardNode(
                id=item.node_id, dashboard_id=dashboard.id, **_node_values(item)
            ),
        )
    await session.flush()
    _write_bindings(session, planned=planned)
    await session.flush()


def _write_bindings(
    session: AsyncSession, *, planned: Sequence[PlannedNode]
) -> None:
    for item in planned:
        for binding in item.bindings:
            binding_crud.add(
                session,
                DashboardBinding(
                    id=binding.binding_id,
                    node_id=item.node_id,
                    **_binding_values(binding.entry),
                ),
            )


def _node_values(item: PlannedNode) -> dict[str, Any]:
    return {
        "parent_id": item.parent_id,
        "client_key": item.entry.client_key,
        "module_type": item.entry.module_type,
        "x_px": item.entry.x_px,
        "y_px": item.entry.y_px,
        "width_px": item.entry.width_px,
        "height_px": item.entry.height_px,
        "z_index": item.entry.z_index,
        "is_visible": item.entry.is_visible,
        "config_json": item.entry.config_json,
    }


def _binding_values(entry: ExportBindingIn) -> dict[str, Any]:
    return {
        "field_key": entry.field_key,
        "source_kind": entry.source_kind,
        "node_key": entry.node_key,
        "static_value_json": entry.static_value_json,
        "compute_json": entry.compute_json,
        "detail_json": entry.detail_json,
        "transform_json": entry.transform_json,
    }


async def _unresolved_bindings(
    planned: Sequence[PlannedNode], *, context: ValidationContext
) -> list[UnresolvedBindingOut]:
    """把包过一遍写入面同一套校验，返回指不到点位的那些绑定。

    Args: planned, context。
    """
    issues = await collect_issues(
        nodes=node_drafts(planned),
        bindings=binding_drafts(planned),
        context=context,
    )
    raise_if_invalid(
        [issue for issue in issues if issue.code != TOLERATED_ISSUE_CODE]
    )
    by_path = {
        binding.field_path: binding
        for item in planned
        for binding in item.bindings
    }
    return [
        _to_unresolved(by_path[_owner_path(issue.field)], issue.code)
        for issue in issues
        if issue.code == TOLERATED_ISSUE_CODE
    ]


def _owner_path(field: str) -> str:
    # 校验问题指到 `<绑定路径>.<字段名>`，去掉末段就回到那条绑定
    return field.rsplit(".", maxsplit=1)[0]


def _to_unresolved(
    binding: PlannedBinding, reason: str
) -> UnresolvedBindingOut:
    return UnresolvedBindingOut(
        node_key=point_key_of(binding.entry),
        field_key=binding.entry.field_key,
        source_kind=binding.entry.source_kind,
        reason=reason,
    )


def _with_unresolved(
    presented: DashboardOut, unresolved: Sequence[UnresolvedBindingOut]
) -> DashboardImportOut:
    return DashboardImportOut(
        **presented.model_dump(), unresolved_bindings=list(unresolved)
    )
