"""采集配置审计只保存显式选出的非敏感状态。"""

import uuid
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.collect.models import (
    CollectAuditEvent,
    CollectPoint,
    CollectSource,
)


@dataclass(frozen=True)
class AuditActor:
    """请求经过鉴权的账号、来源地址与链路。"""

    id: uuid.UUID
    source_ip: str | None
    trace_id: str


class _SourceState(BaseModel):
    protocol: str
    read_mode: str
    poll_interval_ms: int
    is_enabled: bool
    has_credential: bool


class _PointState(BaseModel):
    data_type: str
    sampling_interval_ms: int
    deadband: float
    archive_enabled: bool
    archive_max_interval_ms: int
    archive_retention_days: int | None


type Configuration = CollectSource | CollectPoint
type Snapshot = dict[str, object]


@dataclass(frozen=True)
class ConfigurationChange:
    """动作与更新前的快照。"""

    kind: Literal["created", "updated", "deleted"]
    before: Snapshot | None = None
    submitted_fields: tuple[str, ...] = ()


def snapshot(item: Configuration) -> Snapshot:
    """取配置的脱敏快照。Args: item。"""
    if isinstance(item, CollectSource):
        return _SourceState(
            protocol=item.protocol,
            read_mode=item.read_mode,
            poll_interval_ms=item.poll_interval_ms,
            is_enabled=item.is_enabled,
            has_credential=item.credential_enc is not None,
        ).model_dump()
    return _PointState(
        data_type=item.data_type,
        sampling_interval_ms=item.sampling_interval_ms,
        deadband=item.deadband,
        archive_enabled=item.archive_enabled,
        archive_max_interval_ms=item.archive_max_interval_ms,
        archive_retention_days=item.archive_retention_days,
    ).model_dump()


def record_configuration(
    session: AsyncSession,
    actor: AuditActor,
    item: Configuration,
    change: ConfigurationChange,
) -> None:
    """在配置事务中登记一个目标的变更。Args: session, actor, item, change。"""
    state = snapshot(item)
    if change.submitted_fields:
        state["submitted_fields"] = list(change.submitted_fields)
    is_deleted = change.kind == "deleted"
    is_source = isinstance(item, CollectSource)
    session.add(
        CollectAuditEvent(
            actor_id=actor.id,
            source_ip=actor.source_ip,
            trace_id=actor.trace_id,
            target_kind="source" if is_source else "point",
            target_id=item.id,
            source_id=(
                item.id if isinstance(item, CollectSource) else item.source_id
            ),
            event_kind=change.kind,
            before_json=state if is_deleted else change.before,
            after_json=None if is_deleted else state,
        )
    )


def record_update(
    session: AsyncSession,
    actor: AuditActor,
    item: Configuration,
    before: Snapshot,
    submitted_fields: set[str],
) -> None:
    """仅在配置实际变化时登记更新。

    Args: session, actor, item, before, submitted_fields。
    """
    if not session.is_modified(item, include_collections=False):
        return
    record_configuration(
        session,
        actor,
        item,
        ConfigurationChange("updated", before, tuple(sorted(submitted_fields))),
    )
