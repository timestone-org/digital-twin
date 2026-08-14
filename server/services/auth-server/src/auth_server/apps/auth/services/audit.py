"""审计写入。必须与被审计的变更同一个事务，故只挂 session、从不自己提交。"""

from dataclasses import dataclass
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
ACTION_API_KEY_ISSUED = "api_key_issued"
ACTION_API_KEY_REVOKED = "api_key_revoked"
ACTION_ROUTE_RULE_CREATED = "route_rule_created"
ACTION_ROUTE_RULE_UPDATED = "route_rule_updated"
ACTION_ROUTE_RULE_DELETED = "route_rule_deleted"


@dataclass(frozen=True)
class Change:
    """一次变更的前后值。新建没有 before，删除没有 after。"""

    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None


NO_CHANGE = Change()


@dataclass(frozen=True)
class Entry:
    """一条待写入的审计记录：谁、什么时候、对什么做了什么、改成了什么。"""

    actor: User
    action: str
    target_type: str
    target_id: str | None = None
    change: Change = NO_CHANGE
    source_ip: str | None = None


def record(session: AsyncSession, entry: Entry) -> AuditLog:
    """把一条审计记录挂进当前事务。

    Args: session, entry。
    """
    row = AuditLog(
        actor_id=entry.actor.id,
        actor_username=entry.actor.username,
        action=entry.action,
        target_type=entry.target_type,
        target_id=entry.target_id,
        before=entry.change.before,
        after=entry.change.after,
        source_ip=entry.source_ip,
        trace_id=current_log_context().trace_id,
    )
    session.add(row)
    return row
