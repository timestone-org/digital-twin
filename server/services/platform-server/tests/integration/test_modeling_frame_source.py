"""建模取数保留未来计划，完整历史桶受本轮观测截止约束。"""

import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.dataset_helpers import create_column, create_table
from lib.utils.ids import uuid7
from platform_server.apps.dataset.models import DatasetRecord
from platform_server.apps.modeling.operators import Frame, registry
from platform_server.apps.modeling.services.frame_source import (
    SourceRequest,
    load_frame,
)
from platform_server.apps.modeling.services.preview import summarize

pytestmark = pytest.mark.requires_postgres
START = datetime(2026, 10, 17, 16, tzinfo=UTC)
READ_AT = datetime(2026, 10, 19, 4, tzinfo=UTC)
UNTIL = START + timedelta(days=3)


async def seed_days(client: httpx.AsyncClient, session: AsyncSession) -> str:
    table = await create_table(client, code="daily_cutoff", name="每日输入")
    await create_column(client, str(table["id"]), key="value", name="数值")
    for day, value in enumerate((30, 12, 100)):
        session.add(
            DatasetRecord(
                table_id=uuid.UUID(str(table["id"])),
                row_id=uuid7(),
                ts=START + timedelta(days=day),
                values_json={"value": value},
                source="manual",
            )
        )
    await session.commit()
    return str(table["code"])


@pytest.mark.parametrize(
    ("read_at", "expected"),
    [(READ_AT, ((30.0,),)), (START + timedelta(days=2), ((30.0,), (12.0,)))],
    ids=["unfinished-day", "exact-boundary"],
)
async def test_complete_days_stop_at_read_time_without_dropping_future_inputs(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    read_at: datetime,
    expected: tuple[tuple[float, ...], ...],
) -> None:
    code = await seed_days(app_client, db_session)
    frame = await load_frame(
        db_session,
        request=SourceRequest(
            table_code=code,
            columns=("value",),
            since=START.isoformat(),
            until=UNTIL.isoformat(),
            row_source="manual",
            row_limit=100,
        ),
        now=read_at,
    )
    assert frame.rows == ((30.0,), (12.0,), (100.0,))
    assert frame.provenance.until == UNTIL
    assert (
        summarize(frame)["provenance"]["observed_until"] == read_at.isoformat()
    )
    operator, _ = registry.build(
        "resample",
        {"bucket": "1d", "agg": "sum", "should_keep_complete_buckets": True},
    )
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    result = operator.run({"frame": frame})["frame"]
    assert isinstance(result, Frame)
    assert result.rows == expected
