"""重算任务的两条端点：起 / 查，以及它与回填共用的那把锁（§14.10）。

⚠ 容器上的起跑口只记不跑：受理那一刻任务态是 running、一行都还没算，真跑由
用例在响应返回之后调 `run_launched()`。
"""

import uuid

import pytest
from conftest import AppContext, SignHeaders

from integration.dataset_helpers import (
    HTTP_ACCEPTED,
    HTTP_CONFLICT,
    HTTP_OK,
    TABLES,
    code_of,
    create_column,
    create_record,
    create_table,
    data_of,
    run_recompute,
)
from platform_server.apps.dataset.catalog import DATASET_VIEW

pytestmark = pytest.mark.requires_postgres

HOUR = "2026-08-23T01:00:00.000Z"
HTTP_FORBIDDEN = 403
# 正在回填或重算（`errors.DatasetRecomputeBusy`）
RECOMPUTE_BUSY_CODE = 41233


def recompute_url(table_id: str) -> str:
    """起任务的动作端点。Args: table_id。"""
    return f"{TABLES}/{table_id}:recompute"


def progress_url(table_id: str) -> str:
    """查进度的子资源。Args: table_id。"""
    return f"{TABLES}/{table_id}/recompute"


async def a_formula_table(context: AppContext) -> str:
    """一张有一列公式、一行数据的台账，回它的 id。

    Args: context。
    """
    table = await create_table(context.client)
    table_id = str(table["id"])
    await create_column(context.client, table_id, key="产量")
    await create_column(
        context.client,
        table_id,
        key="双倍",
        source="formula",
        formula="{产量} * 2",
    )
    await create_record(context.client, table_id, ts=HOUR, values={"产量": 4})
    return table_id


async def test_starting_answers_at_once_with_a_running_job(
    app_context: AppContext,
) -> None:
    table_id = await a_formula_table(app_context)

    response = await app_context.client.post(recompute_url(table_id), json={})
    progress = data_of(await app_context.client.get(progress_url(table_id)))

    assert response.status_code == HTTP_ACCEPTED
    started = data_of(response)
    assert (started["status"], started["recomputed"]) == ("running", 0)
    assert progress["status"] == "running"
    assert len(app_context.recompute.launched) == 1


async def test_the_finished_job_reports_and_the_rows_carry_the_new_values(
    app_context: AppContext,
) -> None:
    table_id = await a_formula_table(app_context)

    _, final = await run_recompute(app_context, table_id)
    latest = data_of(
        await app_context.client.get(f"{TABLES}/{table_id}/latest")
    )

    assert (final["status"], final["recomputed"], final["failed"]) == (
        "done",
        1,
        0,
    )
    assert final["finished_at"] is not None
    assert final["message"] == "已重算 1 行"
    assert latest["computed"] == {"双倍": 8.0}


async def test_no_job_reads_as_null_not_as_an_error(
    app_context: AppContext,
) -> None:
    table_id = await a_formula_table(app_context)

    response = await app_context.client.get(progress_url(table_id))

    assert response.status_code == HTTP_OK
    assert data_of(response) is None


async def test_a_second_start_while_one_runs_is_a_conflict(
    app_context: AppContext,
) -> None:
    table_id = await a_formula_table(app_context)
    await app_context.client.post(recompute_url(table_id), json={})

    response = await app_context.client.post(recompute_url(table_id), json={})

    assert response.status_code == HTTP_CONFLICT
    assert code_of(response) == RECOMPUTE_BUSY_CODE


async def test_a_running_recompute_holds_off_a_backfill(
    app_context: AppContext,
) -> None:
    # ⚠ 两者都改写 computed_json：并发时后跑完的一方拿的是对方写入之前的
    # 上文，结果静默错位——故必须抢同一把锁
    table_id = await a_formula_table(app_context)
    await app_context.client.post(recompute_url(table_id), json={})

    claimed = await app_context.backfill.jobs.claim(
        uuid.UUID(table_id), "a-backfill"
    )

    assert claimed is False


async def test_the_lock_is_released_once_the_job_finishes(
    app_context: AppContext,
) -> None:
    table_id = await a_formula_table(app_context)
    await run_recompute(app_context, table_id)

    again = await app_context.client.post(recompute_url(table_id), json={})

    assert again.status_code == HTTP_ACCEPTED


async def test_the_same_idempotency_key_does_not_start_a_second_job(
    app_context: AppContext,
) -> None:
    table_id = await a_formula_table(app_context)
    headers = {"Idempotency-Key": "recompute-once"}

    first = await app_context.client.post(
        recompute_url(table_id), json={}, headers=headers
    )
    replay = await app_context.client.post(
        recompute_url(table_id), json={}, headers=headers
    )

    assert (first.status_code, replay.status_code) == (
        HTTP_ACCEPTED,
        HTTP_ACCEPTED,
    )
    assert len(app_context.recompute.launched) == 1


async def test_a_job_on_a_deleted_table_fails_and_frees_the_lock(
    app_context: AppContext,
) -> None:
    table_id = await a_formula_table(app_context)
    await app_context.client.post(recompute_url(table_id), json={})
    deleted = await app_context.client.delete(f"{TABLES}/{table_id}?force=true")
    assert deleted.status_code < HTTP_CONFLICT, deleted.text

    await app_context.recompute.run_launched()
    state = await app_context.recompute.jobs.read(uuid.UUID(table_id))

    assert state is not None
    assert (state["status"], state["error"]) == (
        "failed",
        "这张台账已被删除，重算中止",
    )


async def test_progress_needs_only_the_view_code(
    app_context: AppContext, sign: SignHeaders
) -> None:
    table_id = await a_formula_table(app_context)

    read = await app_context.client.get(
        progress_url(table_id), headers=sign([DATASET_VIEW])
    )
    start = await app_context.client.post(
        recompute_url(table_id), json={}, headers=sign([DATASET_VIEW])
    )

    assert (read.status_code, start.status_code) == (HTTP_OK, HTTP_FORBIDDEN)
