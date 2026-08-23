"""历史回填对着真库跑：补出来的行、不动的水位、收尾重算与取消。

⚠ 这一层必须打真库：桶聚合的 `time_bucket(…, timezone => …)`、`last(v, ts)
FILTER (…)` 与 `jsonb || (EXCLUDED - text[])` 三样都只有真跑一遍才作数。
计划那一侧（三道 clamp、切批）在 `tests/unit/test_dataset_backfill_plan.py`。
"""

import uuid

import pytest
from conftest import AppContext

from integration.backfill_helpers import (
    POINT,
    Backfiller,
    aggregate_table,
    bucket_ago,
    seed,
)
from integration.collector_helpers import rows_of, watermark_of
from integration.dataset_helpers import DIRTY_KEY, ArchiveWriter, create_column
from platform_server.apps.dataset.crud import column_crud
from platform_server.apps.dataset.services.backfill_jobs import (
    STATUS_CANCELLED,
    STATUS_DONE,
)

pytestmark = pytest.mark.requires_postgres


async def a_point_table(context: AppContext, archive: ArchiveWriter) -> str:
    """一张绑了一个点位、按小时平均的台账，回它的 id。

    Args: context, archive。
    """
    table = await aggregate_table(context.client)
    await create_column(
        context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    return str(table["id"])


async def test_closed_buckets_in_the_range_become_rows(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    table_id = await a_point_table(app_context, archive)
    await seed(archive, bucket_ago(6), 10.0, 20.0, 30.0)
    await seed(archive, bucket_ago(5), 40.0)

    state = await Backfiller(app_context, archive).start(
        table_id, since=bucket_ago(6), until=bucket_ago(5)
    )

    assert state["status"] == STATUS_DONE
    assert (state["total_buckets"], state["done_buckets"]) == (2, 2)
    assert state["written_rows"] == 2
    rows = await rows_of(app_context.client, table_id)
    assert [row["values"]["均温"] for row in rows] == [20.0, 40.0]
    # ⚠ 样本数不是装饰：3 个样本的均值与 3600 个样本的均值长得一模一样
    assert [row["samples"]["均温"] for row in rows] == [3, 1]
    assert [row["source"] for row in rows] == ["collect", "collect"]


async def test_backfill_never_advances_the_collector_watermark(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 水位是**向前采集**的进度，回填补的是它身后的历史。推一下的后果是采集器
    # 从此跳过中间那一段，而它看起来只是「那几天没有数据」
    table_id = await a_point_table(app_context, archive)
    await seed(archive, bucket_ago(4), 5.0)

    await Backfiller(app_context, archive).start(
        table_id, since=bucket_ago(4), until=bucket_ago(4)
    )

    assert await watermark_of(app_context, table_id) is None


async def test_an_empty_bucket_writes_no_row_at_all(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 一格都算不出来的桶写出去就是一行永远解释不清的空记录，而它在图上与一个
    # 真实的零点长得一模一样（D3）
    table_id = await a_point_table(app_context, archive)
    await seed(archive, bucket_ago(7), 1.0)

    state = await Backfiller(app_context, archive).start(
        table_id, since=bucket_ago(9), until=bucket_ago(7)
    )

    assert state["total_buckets"] == 3
    assert state["written_rows"] == 1
    assert len(await rows_of(app_context.client, table_id)) == 1


async def test_running_the_same_range_twice_updates_the_same_row(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 行标识由桶身份 uuid5 派生（D2）：构造式一变，重跑一次同一段就会让每个
    # 桶再长出一行，而两行看起来都对
    table_id = await a_point_table(app_context, archive)
    await seed(archive, bucket_ago(6), 10.0)
    backfiller = Backfiller(app_context, archive)
    await backfiller.start(table_id, since=bucket_ago(6), until=bucket_ago(6))
    first = await rows_of(app_context.client, table_id)

    await seed(archive, bucket_ago(6), 30.0, minute=35)
    await backfiller.start(table_id, since=bucket_ago(6), until=bucket_ago(6))

    second = await rows_of(app_context.client, table_id)
    assert len(second) == 1
    assert second[0]["row_id"] == first[0]["row_id"]
    assert second[0]["values"]["均温"] == 20.0


async def test_a_manual_correction_survives_a_backfill(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 人工修正独占 `overrides_json`，回填与采集一样绝不覆盖它（D4）
    table_id = await a_point_table(app_context, archive)
    await seed(archive, bucket_ago(6), 10.0)
    backfiller = Backfiller(app_context, archive)
    await backfiller.start(table_id, since=bucket_ago(6), until=bucket_ago(6))
    row = (await rows_of(app_context.client, table_id))[0]
    saved = await app_context.client.put(
        f"/api/v1/platform/dataset-tables/{table_id}"
        f"/records/{row['row_id']}/overrides?ts={row['ts']}",
        json={"values": {"均温": 99.0}},
    )
    assert saved.status_code == 200, saved.text

    await seed(archive, bucket_ago(6), 30.0, minute=35)
    await backfiller.start(table_id, since=bucket_ago(6), until=bucket_ago(6))

    after = (await rows_of(app_context.client, table_id))[0]
    assert after["values"]["均温"] == 99.0


async def test_formula_columns_are_computed_after_the_last_batch(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 收尾重算是回填的一部分：最后一次 upsert 之后新行的 `computed_json` 还
    # 空着，停在那里等于留下一批「原始值有、公式值没有」的行
    table_id = await a_point_table(app_context, archive)
    await create_column(
        app_context.client,
        table_id,
        key="翻倍",
        name="翻倍",
        source="formula",
        formula="{均温} * 2",
    )
    await seed(archive, bucket_ago(6), 10.0, 20.0)

    state = await Backfiller(app_context, archive).start(
        table_id, since=bucket_ago(6), until=bucket_ago(6)
    )

    assert state["recomputed"] == 1
    assert state["recompute_failed"] == 0
    rows = await rows_of(app_context.client, table_id)
    assert rows[0]["computed"]["翻倍"] == 30.0


async def test_every_written_batch_reports_the_table_as_dirty(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 回填自开会话、不经请求级事务，故要自己报脏。漏报的表现是大屏数值静默
    # 不更新，没有任何告警（§16）
    table_id = await a_point_table(app_context, archive)
    table = await app_context.client.get(
        f"/api/v1/platform/dataset-tables/{table_id}"
    )
    await seed(archive, bucket_ago(6), 10.0)

    await Backfiller(app_context, archive).start(
        table_id, since=bucket_ago(6), until=bucket_ago(6)
    )

    assert table.json()["data"]["code"] in app_context.dirty.members(DIRTY_KEY)


async def test_a_table_without_point_columns_says_so_instead_of_failing(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    table = await aggregate_table(app_context.client)
    await create_column(app_context.client, str(table["id"]), key="产量")

    state = await Backfiller(app_context, archive).start(
        str(table["id"]), since=bucket_ago(6), until=bucket_ago(5)
    )

    assert state["status"] == STATUS_DONE
    assert state["written_rows"] == 0
    assert "没有绑定点位的汇总列" in state["message"]


async def test_a_cancel_stops_the_run_at_a_batch_boundary(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 取消在**批边界**生效，绝不留写了一半的批
    table_id = await a_point_table(app_context, archive)
    await seed(archive, bucket_ago(6), 10.0)
    backfiller = Backfiller(app_context, archive)
    await backfiller.jobs.request_cancel(uuid.UUID(table_id))

    state = await backfiller.run_now(
        table_id, since=bucket_ago(6), until=bucket_ago(6)
    )

    assert state.status == STATUS_CANCELLED
    assert state.written_rows == 0
    assert await rows_of(app_context.client, table_id) == []


async def test_starting_a_run_clears_the_flag_the_last_one_left(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 上一次任务留下的取消标志会把这一次刚起的回填在第一个批边界直接毙掉，
    # 而回执里只说「已取消」，看不出取消的是上一次
    table_id = await a_point_table(app_context, archive)
    await seed(archive, bucket_ago(6), 10.0)
    backfiller = Backfiller(app_context, archive)
    await backfiller.jobs.request_cancel(uuid.UUID(table_id))

    state = await backfiller.start(
        table_id, since=bucket_ago(6), until=bucket_ago(6)
    )

    assert state["status"] == STATUS_DONE
    assert state["written_rows"] == 1


async def test_a_process_shutdown_stops_the_run_and_says_it_was_cut_short(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 关停与用户按的取消是两件事：前者要让人看出「它没跑完」，
    # 后者是「不用跑了」
    table_id = await a_point_table(app_context, archive)
    await seed(archive, bucket_ago(6), 10.0)
    backfiller = Backfiller(app_context, archive)
    backfiller.stopped.set()

    state = await backfiller.run_now(
        table_id, since=bucket_ago(6), until=bucket_ago(6)
    )

    assert state.status == "failed"
    assert state.written_rows == 0
    assert "关停" in state.message


async def test_the_lock_is_released_once_the_job_is_done(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 锁与任务态是两个键：跑完要放掉锁、留住进度。合成一个的话，「上一次
    # 跑完的记录」会把下一次回填永久挡在门外
    table_id = await a_point_table(app_context, archive)
    await seed(archive, bucket_ago(6), 10.0)
    backfiller = Backfiller(app_context, archive)

    await backfiller.start(table_id, since=bucket_ago(6), until=bucket_ago(6))

    assert await backfiller.jobs.claim(uuid.UUID(table_id), "next") is True


async def test_losing_the_single_flight_lock_stops_the_run(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 续不上就立刻停手：锁已经不在自己手上，意味着**别人正在**改写同一段，
    # 两边接着写只会互相覆盖。这里的任务从没抢过锁，故第一次续锁必然失败
    table_id = await a_point_table(app_context, archive)
    await seed(archive, bucket_ago(6), 10.0)

    state = await Backfiller(app_context, archive).run_now(
        table_id, since=bucket_ago(6), until=bucket_ago(6)
    )

    assert state.status == "failed"
    assert "锁" in state.message
    # 已经提交的那一批仍然有效：停手不等于回滚
    assert state.written_rows == 1


async def test_a_batch_that_blows_its_budget_leaves_no_half_batch(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 一批一个事务、一个预算：超时就是这一批整个不算数
    table_id = await a_point_table(app_context, archive)
    await seed(archive, bucket_ago(6), 10.0)

    state = await Backfiller(
        app_context, archive, batch_timeout_s=0.000_001
    ).run_now(table_id, since=bucket_ago(6), until=bucket_ago(6))

    assert state.status == "failed"
    assert state.written_rows == 0
    assert await rows_of(app_context.client, table_id) == []


async def test_a_formula_that_cannot_compile_does_not_fail_the_backfill(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 原始值已经补进去了，界面该看到的是「补完了，但公式没算」，
    # 而不是一句「回填失败」——后者会让人以为行也没写进去
    table_id = await a_point_table(app_context, archive)
    await create_column(
        app_context.client,
        table_id,
        key="翻倍",
        name="翻倍",
        source="formula",
        formula="{均温} * 2",
    )
    await seed(archive, bucket_ago(6), 10.0)
    backfiller = Backfiller(app_context, archive)
    await _break_the_formula(app_context, table_id)

    state = await backfiller.start(
        table_id, since=bucket_ago(6), until=bucket_ago(6)
    )

    assert state["status"] == STATUS_DONE
    assert state["written_rows"] == 1
    assert state["recomputed"] == 0
    assert any("公式编译不过" in note for note in state["notes"])


async def _break_the_formula(context: AppContext, table_id: str) -> None:
    """把公式列改成一条自引用的环，绕过保存时的校验直接写库。

    ⚠ 只有用例这么干：保存那一面本来就拦得住环（`formula_cycles`），
    而回填要能在库里**已经**有一条坏公式时照样把原始值补完。
    Args: context, table_id。
    """
    columns = await column_crud.list_by_table(
        context.session, uuid.UUID(table_id)
    )
    broken = next(column for column in columns if column.key == "翻倍")
    broken.formula = "{翻倍} + 1"
    await context.session.commit()
