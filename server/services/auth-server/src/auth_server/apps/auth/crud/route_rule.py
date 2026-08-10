"""路由规则数据访问。"""

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.models import RouteRule
from lib.db import CrudBase

SORTABLE = {
    "priority": RouteRule.priority,
    "path_pattern": RouteRule.path_pattern,
    "created_at": RouteRule.created_at,
}
DEFAULT_ORDER = (
    RouteRule.priority.desc(),
    RouteRule.path_pattern.asc(),
    RouteRule.http_method.asc(),
)


class RouteRuleCrud(CrudBase[RouteRule]):
    """`auth_route_rules` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(RouteRule)

    async def list_enabled(self, session: AsyncSession) -> list[RouteRule]:
        """取全部启用规则，按判定顺序排好。

        排序键必须是全序：priority 降 → 模式长度降 → 模式升 → 方法升，
        否则同 priority 下的命中结果依赖数据库返回顺序。
        """
        result = await session.execute(
            select(RouteRule)
            .where(RouteRule.is_enabled.is_(True))
            .order_by(
                RouteRule.priority.desc(),
                func.length(RouteRule.path_pattern).desc(),
                RouteRule.path_pattern.asc(),
                RouteRule.http_method.asc(),
            )
        )
        return list(result.scalars().all())

    async def get_by_key(
        self, session: AsyncSession, *, path_pattern: str, method: str
    ) -> RouteRule | None:
        """按 `(path_pattern, http_method)` 唯一键取规则。

        Args: session, path_pattern, method。
        """
        result = await session.execute(
            select(RouteRule).where(
                RouteRule.path_pattern == path_pattern,
                RouteRule.http_method == method,
            )
        )
        return result.scalars().one_or_none()

    @staticmethod
    def build_query(
        *, keyword: str | None, is_enabled: bool | None
    ) -> Select[tuple[RouteRule]]:
        """按白名单条件构造列表查询。

        Args: keyword, is_enabled。
        """
        statement = select(RouteRule)
        if keyword:
            pattern = f"%{keyword.lower()}%"
            statement = statement.where(
                func.lower(RouteRule.path_pattern).like(pattern)
            )
        if is_enabled is not None:
            statement = statement.where(RouteRule.is_enabled.is_(is_enabled))
        return statement


route_rule_crud = RouteRuleCrud()
