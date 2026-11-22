"""采集配置写入与持久审计的事务契约。"""

from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from integration.collect_helpers import (
    POINTS,
    SOURCES,
    payload,
    point_item,
    source_body,
)
from lib.errors import ValidationFailed
from platform_server.apps.collect.services import audit

pytestmark = pytest.mark.requires_postgres


async def test_source_and_cascaded_point_changes_are_audited(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    secret = "synthetic-credential"
    created = await app_client.post(
        SOURCES, json=source_body(credential=secret, username="synthetic-user")
    )
    assert created.status_code == 201
    source_id = payload(created)["id"]
    patch = await app_client.patch(
        f"{SOURCES}/{source_id}", json={"poll_interval_ms": 2000}
    )
    assert patch.status_code == 200
    points = await app_client.post(
        POINTS, json={"source_id": source_id, "items": [point_item()]}
    )
    assert points.status_code == 201
    removed = await app_client.delete(f"{SOURCES}/{source_id}?force=true")
    assert removed.status_code == 204

    result = await db_session.execute(
        text(
            "SELECT target_kind, event_kind, before_json, after_json, "
            "actor_id, trace_id FROM platform.collect_audit_events "
            "WHERE source_id = :source_id ORDER BY id"
        ),
        {"source_id": UUID(source_id)},
    )
    rows = result.all()
    assert [(row.target_kind, row.event_kind) for row in rows] == [
        ("source", "created"),
        ("source", "updated"),
        ("point", "created"),
        ("point", "deleted"),
        ("source", "deleted"),
    ]
    assert rows[1].before_json["poll_interval_ms"] == 1000
    assert rows[1].after_json["poll_interval_ms"] == 2000
    assert secret not in str(rows)
    assert "synthetic-user" not in str(rows)
    assert all(row.actor_id and row.trace_id for row in rows)


async def test_replayed_configuration_create_has_one_audit_event(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    headers = {"Idempotency-Key": str(uuid4())}
    body = source_body()
    first = await app_client.post(SOURCES, json=body, headers=headers)
    again = await app_client.post(SOURCES, json=body, headers=headers)
    assert first.status_code == again.status_code == 201
    assert payload(first)["id"] == payload(again)["id"]
    count = await db_session.scalar(
        text(
            "SELECT count(*) FROM platform.collect_audit_events "
            "WHERE target_id = :target_id"
        ),
        {"target_id": UUID(payload(first)["id"])},
    )
    assert count == 1


async def test_audit_failure_rolls_back_the_configuration_change(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = await app_client.post(SOURCES, json=source_body())
    assert created.status_code == 201
    source_id = payload(created)["id"]

    def refuse(*_args: object) -> None:
        raise ValidationFailed("合成审计持久化故障")

    monkeypatch.setattr(audit, "record_configuration", refuse)
    changed = await app_client.patch(
        f"{SOURCES}/{source_id}", json={"poll_interval_ms": 2000}
    )
    assert changed.status_code == 400
    read = await app_client.get(f"{SOURCES}/{source_id}")
    assert payload(read)["poll_interval_ms"] == 1000
    result = await db_session.execute(
        text(
            "SELECT event_kind FROM platform.collect_audit_events "
            "WHERE source_id = :source_id"
        ),
        {"source_id": UUID(source_id)},
    )
    assert list(result.scalars()) == ["created"]


async def test_unauthorized_request_does_not_record_configuration(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    before = await db_session.scalar(
        text("SELECT count(*) FROM platform.collect_audit_events")
    )
    app_client.headers.clear()
    response = await app_client.post(SOURCES, json=source_body())
    assert response.status_code in (401, 403)
    assert (
        await db_session.scalar(
            text("SELECT count(*) FROM platform.collect_audit_events")
        )
        == before
    )
