"""审计写入。必须与被审计的变更同一个事务，故只挂 session、从不自己提交。"""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.models import AuditLog, User
from lib.logging import current_log_context

# 稳定字面量，不许拼变量
ACTION_USER_CREATED = "user_created"
ACTION_USER_UPDATED = "user_updated"
ACTION_USER_DELETED = "user_deleted"
ACTION_USER_ACTIVATED = "user_activated"
ACTION_USER_DEACTIVATED = "user_deactivated"
ACTION_PASSWORD_RESET = "user_password_reset"  # noqa: S105  事件名，不是口令
ACTION_ROLE_ASSIGNED = "user_role_assigned"
ACTION_DIRECT_PERMISSIONS_SET = "user_direct_permissions_set"
ACTION_ROLE_CREATED = "role_created"
ACTION_ROLE_UPDATED = "role_updated"
ACTION_ROLE_DELETED = "role_deleted"
ACTION_ROLE_PERMISSIONS_SET = "role_permissions_set"
ACTION_ROUTE_RULE_CREATED = "route_rule_created"
ACTION_ROUTE_RULE_UPDATED = "route_rule_updated"
ACTION_ROUTE_RULE_DELETED = "route_rule_deleted"


def record(
    session: AsyncSession,
    *,
    actor: User,
    action: str,
    target_type: str,
    target_id: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    source_ip: str | None = None,
) -> AuditLog:
    """把一条审计记录挂进当前事务。

    Args: session, actor, action, target_type, target_id, before, after,
        source_ip。
    """
    entry = AuditLog(
        actor_id=actor.id,
        actor_username=actor.username,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before=before,
        after=after,
        source_ip=source_ip,
        trace_id=current_log_context().trace_id,
    )
    session.add(entry)
    return entry
