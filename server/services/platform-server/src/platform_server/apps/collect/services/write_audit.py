"""写值的意图与结算分别提交，两者之间没有数据库事务。"""

import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.utils.ids import uuid7
from platform_server.apps.collect.errors import CollectorUnreachable
from platform_server.apps.collect.models import CollectAuditEvent
from platform_server.apps.collect.services.audit import AuditActor

_logger = get_logger("platform.collect.write_audit")

type Settlement = Literal[
    "write_confirmed", "write_rejected", "write_unconfirmed"
]


@dataclass(frozen=True)
class WriteIntent:
    """已提交的现场写值意图。"""

    id: uuid.UUID
    actor: AuditActor
    point_id: uuid.UUID
    source_id: uuid.UUID


async def begin(
    session: AsyncSession,
    actor: AuditActor,
    point_id: uuid.UUID,
    source_id: uuid.UUID,
) -> WriteIntent:
    """先提交写值意图。Args: session, actor, point_id, source_id。"""
    intent = WriteIntent(uuid7(), actor, point_id, source_id)
    session.add(_event(intent, "write_intent"))
    try:
        await session.commit()
    except Exception as error:
        _logger.warning(
            "collect_write_audit_intent_failed",
            "写值意图未能确认，命令未发送",
            intent_id=str(intent.id),
            error_type=type(error).__name__,
        )
        raise CollectorUnreachable("写值未下发，审计暂不可用") from error
    return intent


async def settle(
    session: AsyncSession,
    intent: WriteIntent,
    kind: Settlement,
    *,
    outcome_code: int | None = None,
) -> bool:
    """独立追加设备结算。Args: session, intent, kind, outcome_code。"""
    session.add(_event(intent, kind, outcome_code))
    try:
        await session.commit()
    except Exception as error:
        _logger.warning(
            "collect_write_audit_settlement_failed",
            "现场写值审计结算未能确认",
            intent_id=str(intent.id),
            error_type=type(error).__name__,
        )
        return False
    return True


def _event(
    intent: WriteIntent,
    kind: Settlement | Literal["write_intent"],
    outcome_code: int | None = None,
) -> CollectAuditEvent:
    is_intent = kind == "write_intent"
    return CollectAuditEvent(
        id=intent.id if is_intent else uuid7(),
        actor_id=intent.actor.id,
        source_ip=intent.actor.source_ip,
        trace_id=intent.actor.trace_id,
        target_kind="point",
        target_id=intent.point_id,
        source_id=intent.source_id,
        event_kind=kind,
        intent_id=None if is_intent else intent.id,
        outcome_code=outcome_code,
    )
