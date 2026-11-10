"""重算任务的起跑与查进度（docs/DATASET_DESIGN.md §14.10）。"""

import contextlib
import uuid

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.utils.ids import uuid7
from lib.utils.timeutils import to_utc, utcnow
from platform_server.apps.dataset.errors import (
    DatasetBackfillUnreadable,
    DatasetRecomputeBusy,
)
from platform_server.apps.dataset.schemas import RecomputeIn, RecomputeJobOut
from platform_server.apps.dataset.services.recompute_run import (
    STATUS_RUNNING,
    RecomputeJobState,
    RecomputeRunner,
)
from platform_server.apps.dataset.services.table_service import require_table

_logger = get_logger("platform.dataset.compute")


async def start_recompute(
    session: AsyncSession,
    runner: RecomputeRunner,
    *,
    table_id: uuid.UUID,
    payload: RecomputeIn,
) -> RecomputeJobOut:
    """校验 → 抢锁 → 落任务态 → 起后台任务，回初始任务态。

    Args: session, runner, table_id, payload。
    """
    table = await require_table(session, table_id)
    token = f"{runner.instance}:recompute:{uuid7().hex}"
    if not await runner.jobs.claim(table_id, token):
        raise DatasetRecomputeBusy(
            f"台账「{table.code}」正在回填或重算，等它结束再来"
        )
    now = utcnow()
    since = None if payload.since is None else to_utc(payload.since)
    until = None if payload.until is None else to_utc(payload.until)
    state = RecomputeJobState(
        table_id=str(table.id),
        table_code=table.code,
        status=STATUS_RUNNING,
        since=since,
        until=until,
        started_at=now,
        updated_at=now,
        message="重算中",
    )
    try:
        await runner.jobs.write(state, at=now)
    except Exception:
        # ⚠ 落不下任务态就放锁再抛：留着它，下一次重算白等一个 TTL，而界面上
        # 只会说「正在回填或重算」——其实一个都没起来
        with contextlib.suppress(Exception):
            await runner.jobs.release(table_id, token)
        raise
    runner.launch(state, token=token)
    _logger.info(
        "dataset_recompute_started", "重算任务已起", table_code=table.code
    )
    return _to_out(state.to_payload())


async def read_recompute(
    session: AsyncSession, runner: RecomputeRunner, *, table_id: uuid.UUID
) -> RecomputeJobOut | None:
    """查这张表的重算进度；当前没有任务（或记录已过期）给 None。

    ⚠ 「读不出来」由 `jobs.read` 响亮抛出，绝不兜成 None。
    Args: session, runner, table_id。
    """
    await require_table(session, table_id)
    found = await runner.jobs.read(table_id)
    return None if found is None else _to_out(found)


def _to_out(payload: dict[str, object]) -> RecomputeJobOut:
    """把 Redis 上那份 JSON 收窄成出参；形状对不上抛「读不出来」。

    Args: payload。
    """
    try:
        return RecomputeJobOut.model_validate(payload)
    except ValidationError as error:
        raise DatasetBackfillUnreadable(
            "重算进度暂时读不出来，请稍后再看"
        ) from error
