"""把目录里的路由规则转成闸 1 判定用的视图，供各张路由矩阵共用。

每张矩阵都要按**运行时那套排序**去解析路径，自己拼一份视图就会漂。
"""

from auth_server.apps.auth import catalog
from auth_server.apps.auth.services.matching import RuleView


def catalog_rule_views() -> list[RuleView]:
    """目录里的全部内置规则，未排序（`find_rule` 自己排）。"""
    return [
        RuleView(
            path_pattern=spec.path_pattern,
            http_method=spec.http_method,
            permission_codes=frozenset(spec.codes),
            match_mode=spec.match_mode,
            priority=spec.priority,
        )
        for spec in catalog.ROUTE_RULES
    ]
