"""路由规则管理面，外加供闸 1 复用的规则缓存。

⚠ 缓存是**进程内**的：多副本下失效只作用于本副本，跨副本的收敛靠 TTL 兜底。
TTL 取秒级——改一条规则要等一个 TTL 才全站生效，这是可接受的；
把它调大到分钟级会让「改了规则没反应」变成常见投诉。
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.crud import route_rule_crud
from auth_server.apps.auth.crud.route_rule import DEFAULT_ORDER, SORTABLE
from auth_server.apps.auth.models import RouteRule
from auth_server.apps.auth.schemas import (
    RouteRuleCreateIn,
    RouteRuleOut,
    RouteRuleUpdateIn,
)
from auth_server.apps.auth.services import audit
from auth_server.apps.auth.services.grant_service import (
    resolve_permission_ids,
)
from auth_server.apps.auth.services.identity import Operation
from auth_server.apps.auth.services.matching import RuleView
from auth_server.apps.auth.services.presenters import to_route_rule_out
from lib.errors import Conflict, NotFound
from lib.utils.timeutils import Clock, utcnow
from lib.web import Page, PageParams

TARGET_TYPE = "route_rule"
DEFAULT_CACHE_TTL_S = 10.0


@dataclass
class RouteRuleCache:
    """闸 1 的规则缓存。写路径改完即失效，读路径按 TTL 兜底。"""

    ttl_s: float = DEFAULT_CACHE_TTL_S
    clock: Clock = utcnow
    _rules: list[RuleView] = field(default_factory=list[RuleView])
    _loaded_at: datetime | None = None

    async def rules(self, session: AsyncSession) -> list[RuleView]:
        """取判定用的规则集，必要时回源。

        Args: session。
        """
        now = self.clock()
        if self._loaded_at is not None:
            age = (now - self._loaded_at).total_seconds()
            if age < self.ttl_s:
                return self._rules
        rows = await route_rule_crud.list_enabled(session)
        self._rules = [_to_view(row) for row in rows]
        self._loaded_at = now
        return self._rules

    def invalidate(self) -> None:
        """丢弃缓存，下次读立刻回源。"""
        self._loaded_at = None


def _to_view(rule: RouteRule) -> RuleView:
    return RuleView(
        path_pattern=rule.path_pattern,
        http_method=rule.http_method,
        permission_codes=frozenset(rule.permission_codes),
        match_mode=rule.match_mode,
        priority=rule.priority,
    )


async def list_rules(
    session: AsyncSession,
    *,
    keyword: str | None,
    is_enabled: bool | None,
    page: PageParams,
    sort: str | None,
) -> Page[RouteRuleOut]:
    """规则列表，默认按判定顺序排列。

    Args: session, keyword, is_enabled, page, sort。
    """
    statement = route_rule_crud.order_by_whitelist(
        route_rule_crud.build_query(keyword=keyword, is_enabled=is_enabled),
        sort=sort,
        allowed=dict(SORTABLE),
        default=DEFAULT_ORDER,
    )
    rows, total = await route_rule_crud.list_page(
        session, statement=statement, offset=page.offset, limit=page.size
    )
    return Page[RouteRuleOut](
        items=[to_route_rule_out(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_rule(session: AsyncSession, rule_id: uuid.UUID) -> RouteRuleOut:
    """规则详情。

    Args: session, rule_id。
    """
    return to_route_rule_out(await _require_rule(session, rule_id))


async def create_rule(
    session: AsyncSession,
    operation: Operation,
    *,
    payload: RouteRuleCreateIn,
    cache: RouteRuleCache,
) -> RouteRuleOut:
    """新增规则。

    Args: session, operation, payload, cache。
    """
    await resolve_permission_ids(session, frozenset(payload.permission_codes))
    rule = RouteRule(
        path_pattern=payload.path_pattern,
        http_method=payload.http_method,
        permission_codes=sorted(set(payload.permission_codes)),
        match_mode=payload.match_mode,
        priority=payload.priority,
        is_enabled=payload.is_enabled,
        description=payload.description,
    )
    session.add(rule)
    await _flush(session)
    _audit(
        session,
        operation,
        audit.ACTION_ROUTE_RULE_CREATED,
        rule,
        audit.Change(after=_snapshot(rule)),
    )
    cache.invalidate()
    return to_route_rule_out(rule)


async def update_rule(
    session: AsyncSession,
    operation: Operation,
    *,
    rule_id: uuid.UUID,
    payload: RouteRuleUpdateIn,
    cache: RouteRuleCache,
) -> RouteRuleOut:
    """改规则。

    Args: session, operation, rule_id, payload, cache。
    """
    rule = await _require_rule(session, rule_id)
    changes = payload.model_dump(exclude_unset=True)
    codes = changes.get("permission_codes")
    if codes is not None:
        await resolve_permission_ids(session, frozenset(codes))
        changes["permission_codes"] = sorted(set(codes))
    before = _snapshot(rule)
    route_rule_crud.apply_changes(rule, changes)
    await _flush(session)
    _audit(
        session,
        operation,
        audit.ACTION_ROUTE_RULE_UPDATED,
        rule,
        audit.Change(before=before, after=_snapshot(rule)),
    )
    cache.invalidate()
    return to_route_rule_out(rule)


async def delete_rule(
    session: AsyncSession,
    operation: Operation,
    *,
    rule_id: uuid.UUID,
    cache: RouteRuleCache,
) -> None:
    """删规则。

    Args: session, operation, rule_id, cache。
    """
    rule = await _require_rule(session, rule_id)
    _audit(
        session,
        operation,
        audit.ACTION_ROUTE_RULE_DELETED,
        rule,
        audit.Change(before=_snapshot(rule)),
    )
    await route_rule_crud.delete(session, rule)
    cache.invalidate()


async def _require_rule(session: AsyncSession, rule_id: uuid.UUID) -> RouteRule:
    rule = await route_rule_crud.get(session, rule_id)
    if rule is None:
        raise NotFound("路由规则不存在")
    return rule


def _snapshot(rule: RouteRule) -> dict[str, object]:
    return {
        "path_pattern": rule.path_pattern,
        "http_method": rule.http_method,
        "permission_codes": sorted(rule.permission_codes),
        "match_mode": rule.match_mode,
        "priority": rule.priority,
        "is_enabled": rule.is_enabled,
    }


def _audit(
    session: AsyncSession,
    operation: Operation,
    action: str,
    rule: RouteRule,
    change: audit.Change = audit.NO_CHANGE,
) -> None:
    audit.record(
        session,
        audit.Entry(
            actor=operation.operator.user,
            action=action,
            target_type=TARGET_TYPE,
            target_id=str(rule.id),
            change=change,
            source_ip=operation.source_ip,
        ),
    )


async def _flush(session: AsyncSession) -> None:
    try:
        await session.flush()
    except IntegrityError as error:
        raise Conflict("同一路径与方法的规则已存在") from error
