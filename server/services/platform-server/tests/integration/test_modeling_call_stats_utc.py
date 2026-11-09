"""调用统计按 UTC 日切桶，与数据库会话时区无关。

⚠ 两参数的 `date_trunc` 按会话时区截断：东八区默认时区的库上，「一天」是
当地日、序列化出来却标成 16:00Z。
"""

import uuid
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.test_modeling_open_api import _served
from platform_server.apps.modeling.crud.deployment import call_log_crud
from platform_server.apps.modeling.models import ModelingCallLog

pytestmark = pytest.mark.requires_postgres


async def test_call_stats_bucket_by_utc_day_under_a_local_session_zone(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    deployment, _ = await _served(
        app_client, db_session, worker_sessions, "utc-day"
    )
    deployment_id = uuid.UUID(deployment["id"])
    for hour in (15, 16):
        db_session.add(
            ModelingCallLog(
                deployment_id=deployment_id,
                row_count=1,
                duration_ms=1,
                status=200,
                created_at=datetime(2026, 1, 1, hour, 30, tzinfo=UTC),
            )
        )
    await db_session.flush()
    await db_session.execute(text("SET TIME ZONE 'Asia/Shanghai'"))
    counted = await call_log_crud.daily_counts(
        db_session, deployment_id, datetime(2025, 12, 31, tzinfo=UTC)
    )
    assert [(day.astimezone(UTC), total) for day, total, _ in counted] == [
        (datetime(2026, 1, 1, tzinfo=UTC), 2)
    ]
