"""校验的汇合点：逐节点写与整树替换都从这里过。

写错就响亮失败，`details[]` 指到具体字段（ADR-0012 四）。参考实现是静默降级
加 200——Agent 看不见画布，它只有响应，一个「200 却把节点悄悄挪到顶层」的
接口会让它带着错误继续往下走。
"""

from collections.abc import Sequence
from dataclasses import dataclass

from lib.errors import AppError, FieldError
from platform_server.apps.dashboard.errors import (
    BindingSourceInvalid,
    ClientKeyTaken,
    FieldKeyTaken,
    LayoutInvalid,
)
from platform_server.apps.dashboard.services.binding_rules import (
    check_field_keys,
    check_sources,
    referenced_node_keys,
)
from platform_server.apps.dashboard.services.drafts import (
    BindingDraft,
    NodeDraft,
)
from platform_server.apps.dashboard.services.module_catalog import (
    ModuleCatalog,
)
from platform_server.apps.dashboard.services.node_rules import check_nodes
from platform_server.apps.dashboard.services.point_catalog import PointCatalog

# 撞键是冲突不是参数错，各自有自己的 409；其余结构类问题归 41010、
# 来源类问题归 41011。⚠ `details` 无论走哪条都一次给全——让调用方一趟就能
# 把全部错处改掉，而不是修一条再发一次才看见下一条
CONFLICT_CODES: dict[str, type[AppError]] = {
    "client_key_taken": ClientKeyTaken,
    "field_key_taken": FieldKeyTaken,
}
STRUCTURAL_CODES = frozenset(
    {
        "array_index_gap",
        "field_key_unknown",
        "module_type_unknown",
        "parent_cycle",
        "parent_is_self",
        "parent_not_found",
    }
)


@dataclass(frozen=True)
class ValidationContext:
    """校验要问的两件外部事实：模块清单与点位台账。"""

    catalog: ModuleCatalog
    points: PointCatalog


async def collect_issues(
    *,
    nodes: Sequence[NodeDraft],
    bindings: Sequence[BindingDraft],
    context: ValidationContext,
) -> list[FieldError]:
    """把一份**最终形态**的节点树与绑定查一遍，返回全部问题。

    Args: nodes, bindings, context。
    """
    module_types = {node.node_id: node.module_type for node in nodes}
    known = await context.points.known_node_keys(referenced_node_keys(bindings))
    return [
        *check_nodes(nodes, catalog=context.catalog),
        *check_field_keys(
            bindings, module_types=module_types, catalog=context.catalog
        ),
        *check_sources(bindings, known_node_keys=known),
    ]


def raise_if_invalid(issues: Sequence[FieldError]) -> None:
    """有问题就抛，没有就返回。

    Args: issues。
    """
    if not issues:
        return
    details = tuple(issues)
    conflict = next(
        (
            CONFLICT_CODES[issue.code]
            for issue in issues
            if issue.code in CONFLICT_CODES
        ),
        None,
    )
    if conflict is not None:
        raise conflict("这张大屏里已经有同名的键", details=details)
    if any(issue.code in STRUCTURAL_CODES for issue in issues):
        raise LayoutInvalid("节点树不合法", details=details)
    raise BindingSourceInvalid("绑定来源不合法", details=details)
