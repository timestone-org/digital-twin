"""回填的三条端点：起 / 查 / 取消，以及它们各自的权限码与幂等。

⚠ 起与取消要 `dataset:backfill`，查进度只要 `dataset:view`（§9）：看一眼进度
的人不该顺带拿到改写历史的权限。
"""

import uuid
from datetime import timedelta

import httpx
import pytest
from conftest import AppContext, SignHeaders
from unit.dataset_fakes import HalfBrokenStore

from integration.backfill_helpers import (
    aggregate_table,
    backfill_url,
    bucket_ago,
    current_bucket,
)
from integration.dataset_helpers import (
    HTTP_CONFLICT,
    HTTP_NOT_FOUND,
    HTTP_OK,
    code_of,
    create_column,
    data_of,
)
from lib.utils.timeutils import format_rfc3339
from platform_server.apps.dataset.catalog import (
    DATASET_BACKFILL,
    DATASET_VIEW,
)
from platform_server.apps.dataset.services import BackfillJobs
from platform_server.apps.dataset.services.backfill_jobs import KEY_PREFIX

pytestmark = pytest.mark.requires_postgres

HTTP_ACCEPTED = 202
HTTP_BAD_REQUEST = 400
HTTP_FORBIDDEN = 403
HTTP_UNAVAILABLE = 503
# 回填区间不合法（`errors.DatasetBackfillInvalid`）
INVALID_RANGE_CODE = 41230


def a_range(*, first: int, last: int) -> dict[str, str]:
    """几个桶之前到几个桶之前的那一段。

    Args: first（更早的那一头）, last。
    """
    return {
        "since": format_rfc3339(bucket_ago(first)),
        "until": format_rfc3339(bucket_ago(last)),
    }


async def a_table_with_a_point(context: AppContext) -> str:
    """一张绑了一个点位的按小时台账，回它的 id。

    ⚠ 绑的点位不必真有数据：这一批用例验的是端点与任务态，不是折算出来的值。
    Args: context。
    """
    table = await aggregate_table(context.client)
    await create_column(
        context.client,
        str(table["id"]),
        key="均温",
        name="均温",
        source="point",
        node_key=f"{uuid.uuid4()}:meter_kwh",
        agg="avg",
    )
    return str(table["id"])


async def test_starting_a_backfill_answers_with_the_whole_job(
    app_context: AppContext,
) -> None:
    table_id = await a_table_with_a_point(app_context)

    response = await app_context.client.post(
        backfill_url(table_id), json=a_range(first=8, last=6)
    )

    assert response.status_code == HTTP_ACCEPTED, response.text
    job = data_of(response)
    assert job["status"] == "running"
    assert job["total_buckets"] == 3
    assert job["done_buckets"] == 0
    # ⚠ 本仓的点位历史没有连续聚合视图，回执要如实说出来而不是留一个永远
    # 填不上的「快路」字段
    assert job["fast_path"] == "raw"
    assert any("原始表" in note for note in job["notes"])
    await app_context.backfill.drain(timeout_s=30)


async def test_the_requested_range_is_echoed_next_to_the_clamped_one(
    app_context: AppContext,
) -> None:
    # ⚠ 只给实际区间的话，被裁掉的那一段在界面上无从对比，用户看到的只是
    # 「它补的比我要的少」，而少在哪一头看不出来
    table_id = await a_table_with_a_point(app_context)
    until = format_rfc3339(current_bucket() + timedelta(hours=1))

    response = await app_context.client.post(
        backfill_url(table_id),
        json={"since": format_rfc3339(bucket_ago(8)), "until": until},
    )

    job = data_of(response)
    assert job["requested_until"] == until
    assert job["until"] < until
    assert job["is_clamped"] is True
    assert any("向前采集器" in note for note in job["notes"])
    await app_context.backfill.drain(timeout_s=30)


async def test_a_range_with_no_backfillable_bucket_is_a_bad_request(
    app_context: AppContext,
) -> None:
    table_id = await a_table_with_a_point(app_context)

    response = await app_context.client.post(
        backfill_url(table_id), json=a_range(first=0, last=0)
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert code_of(response) == INVALID_RANGE_CODE


async def test_a_second_backfill_on_a_busy_table_is_refused(
    app_context: AppContext,
) -> None:
    # ⚠ 单飞锁在 Redis 上而不是进程内：起任务的副本与受理这一次的副本可以是
    # 两个进程
    table_id = await a_table_with_a_point(app_context)
    await app_context.backfill.jobs.claim(uuid.UUID(table_id), "someone-else")

    response = await app_context.client.post(
        backfill_url(table_id), json=a_range(first=8, last=6)
    )

    assert response.status_code == HTTP_CONFLICT


async def test_the_same_idempotency_key_does_not_start_a_second_job(
    app_context: AppContext,
) -> None:
    # ⚠ 长任务必须支持幂等键（§6.3）：不支持的话，客户端的一次重试撞上的是
    # 自己刚起的那个任务留下的单飞锁，用户看到一句莫名其妙的 409
    table_id = await a_table_with_a_point(app_context)
    body = a_range(first=8, last=6)
    headers = {"Idempotency-Key": "backfill-once"}

    first = await app_context.client.post(
        backfill_url(table_id), json=body, headers=headers
    )
    second = await app_context.client.post(
        backfill_url(table_id), json=body, headers=headers
    )

    assert (first.status_code, second.status_code) == (
        HTTP_ACCEPTED,
        HTTP_ACCEPTED,
    )
    assert data_of(second)["started_at"] == data_of(first)["started_at"]
    await app_context.backfill.drain(timeout_s=30)


async def test_a_table_with_no_job_answers_null_rather_than_404(
    app_context: AppContext,
) -> None:
    # ⚠ 「没有任务」与「表不存在」是两件事：合成一个 404 的话，界面无从分辨
    # 「这张表还没回填过」与「这张表被人删了」
    table_id = await a_table_with_a_point(app_context)

    response = await app_context.client.get(backfill_url(table_id))

    assert response.status_code == HTTP_OK
    assert data_of(response) is None


async def test_the_progress_endpoint_gives_back_the_whole_job(
    app_context: AppContext,
) -> None:
    # ⚠ 起任务与查进度共用一个形状：两个形状的话，界面要为「刚起」与「查回来」
    # 各写一遍渲染，而其中一份迟早跟不上另一份
    table_id = await a_table_with_a_point(app_context)
    started = await app_context.client.post(
        backfill_url(table_id), json=a_range(first=8, last=6)
    )

    response = await app_context.client.get(backfill_url(table_id))

    assert data_of(response) == data_of(started)


async def test_cancelling_when_nothing_runs_is_a_404(
    app_context: AppContext,
) -> None:
    table_id = await a_table_with_a_point(app_context)

    response = await app_context.client.delete(backfill_url(table_id))

    assert response.status_code == HTTP_NOT_FOUND


async def test_cancelling_a_running_job_raises_the_flag_the_worker_reads(
    app_context: AppContext,
) -> None:
    # ⚠ 取消是协作式的：写一个 Redis 标志，worker 在下一个批边界停下。
    # `task.cancel()` 只停得了本进程手上那个任务
    table_id = await a_table_with_a_point(app_context)
    await app_context.client.post(
        backfill_url(table_id), json=a_range(first=8, last=6)
    )
    await app_context.backfill.drain(timeout_s=30)
    await _mark_running_again(app_context, table_id)

    response = await app_context.client.delete(backfill_url(table_id))

    assert response.status_code == HTTP_OK
    assert await app_context.backfill.jobs.is_cancelled(uuid.UUID(table_id))


async def _mark_running_again(context: AppContext, table_id: str) -> None:
    """把刚跑完那份任务态改回「在跑」，好让取消端点有活可干。

    ⚠ 直接改任务态而不是去起一个真的长任务：这条用例验的是端点与标志，
    而「批边界上真的停下来」由 `test_dataset_backfill.py` 对着真库验——
    靠一个跑得够久的任务来卡住时序，换来的是一条会看运气的用例。
    Args: context, table_id。
    """
    jobs = context.backfill.jobs
    found = await jobs.read(uuid.UUID(table_id))
    assert found is not None
    found["status"] = "running"
    await jobs.store.set_json(
        f"{KEY_PREFIX}{table_id}", found, ttl_s=jobs.state_ttl_s
    )


async def test_reading_progress_needs_only_the_view_code(
    app_client: httpx.AsyncClient, app_context: AppContext, sign: SignHeaders
) -> None:
    table_id = await a_table_with_a_point(app_context)

    response = await app_client.get(
        backfill_url(table_id), headers=sign([DATASET_VIEW])
    )

    assert response.status_code == HTTP_OK


async def test_the_view_code_alone_cannot_start_a_backfill(
    app_client: httpx.AsyncClient, app_context: AppContext, sign: SignHeaders
) -> None:
    # ⚠ 一次回填按点位历史重算一大段时间的台账行，爆炸半径与全表重算同级
    table_id = await a_table_with_a_point(app_context)

    response = await app_client.post(
        backfill_url(table_id),
        json=a_range(first=8, last=6),
        headers=sign([DATASET_VIEW]),
    )

    assert response.status_code == HTTP_FORBIDDEN


async def test_the_backfill_code_alone_cannot_read_the_table_list(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.get(
        "/api/v1/platform/dataset-tables", headers=sign([DATASET_BACKFILL])
    )

    assert response.status_code == HTTP_FORBIDDEN


async def test_a_start_that_cannot_record_its_progress_frees_the_lock(
    app_context: AppContext,
) -> None:
    # ⚠ 抢下的锁必须放掉：留着它等于让这张表的下一次回填白等一个 TTL，
    # 而界面上只会说「已经有一个回填在跑」——其实一个都没起来
    table_id = await a_table_with_a_point(app_context)
    app_context.backfill.jobs = BackfillJobs(store=HalfBrokenStore())

    response = await app_context.client.post(
        backfill_url(table_id), json=a_range(first=8, last=6)
    )

    assert response.status_code == HTTP_UNAVAILABLE
    assert await app_context.backfill.jobs.claim(uuid.UUID(table_id), "next")
