"""权限目录（只读）。目录由种子驱动，运行时新建的码没有任何消费方。"""

from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.crud import permission_crud
from auth_server.apps.auth.models import Permission
from auth_server.apps.auth.schemas import (
    PermissionCatalogOut,
    PermissionGroupOut,
    PermissionOut,
)
from auth_server.apps.auth.services.presenters import to_permission_out


async def get_catalog(session: AsyncSession) -> PermissionCatalogOut:
    """全量权限目录，同时给扁平表与分组视图。

    Args: session。
    """
    rows = await permission_crud.list_all(session)
    items = [to_permission_out(row) for row in rows]
    return PermissionCatalogOut(items=items, groups=_group(rows))


def _group(rows: list[Permission]) -> list[PermissionGroupOut]:
    order: list[str] = []
    buckets: dict[str, list[PermissionOut]] = {}
    labels: dict[str, str] = {}
    for row in rows:
        if row.group_code not in buckets:
            buckets[row.group_code] = []
            labels[row.group_code] = row.group_label
            order.append(row.group_code)
        buckets[row.group_code].append(to_permission_out(row))
    return [
        PermissionGroupOut(code=code, label=labels[code], items=buckets[code])
        for code in order
    ]
