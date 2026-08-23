"""数据行的录入、编辑、删除与翻页。

⚠ 这条链上有四处「不报错但错」：出参里的 `values` 忘了叠修正（前端会再叠一遍
而叠出双份）、编辑时整体覆盖两份 JSONB（采集原值凭空消失）、改数据时间时就地
UPDATE（`ts` 是分区键，改不动）、以及写完不报脏（大屏静默不更新）。
"""

from typing import Any

import httpx
import pytest
from conftest import AppContext
from unit.dataset_fakes import FakeSetSink

from integration.dataset_helpers import (
    DIRTY_KEY,
    HTTP_BAD_REQUEST,
    HTTP_CREATED,
    HTTP_NOT_FOUND,
    TABLES,
    code_of,
    create_column,
    create_record,
    create_table,
    data_of,
    record_url,
    records_url,
)
from lib.utils.ids import uuid7

pytestmark = pytest.mark.requires_postgres

RECORD_NOT_FOUND = 41207
RECORD_INVALID = 41213
NODE_KEY = "0192f0c0-0000-7000-8000-00000000abcd:outlet_temp"
FIRST_MOMENT = "2026-08-23T10:00:00.000Z"
SECOND_MOMENT = "2026-08-23T11:00:00.000Z"


async def seed_table(client: httpx.AsyncClient, **column: Any) -> str:
    """建一张带一列的台账，回它的 id。"""
    table = await create_table(client)
    await create_column(client, table["id"], **column)
    return str(table["id"])


async def test_a_new_record_carries_a_location_header(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_table(app_client)

    response = await app_client.post(
        records_url(table_id), json={"ts": FIRST_MOMENT, "values": {"产量": 7}}
    )

    assert response.status_code == HTTP_CREATED
    created = data_of(response)
    assert response.headers["Location"] == (
        f"{TABLES}/{table_id}/records/{created['record']['row_id']}"
    )


async def test_a_manual_value_lands_in_the_row(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_table(app_client)

    created = await create_record(
        app_client, table_id, ts=FIRST_MOMENT, values={"产量": 7}
    )

    assert created["record"]["values"] == {"产量": 7.0}
    assert created["record"]["overrides"] is None
    assert created["record"]["source"] == "manual"


async def test_a_point_column_value_is_recorded_as_a_correction(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 点位汇总列的值不由人写、只由人「改」：落进 values_json 的话，下一轮
    # 采集会把它覆盖掉，而用户以为自己填的数还在
    table_id = await seed_table(
        app_client, key="温度", source="point", node_key=NODE_KEY
    )

    created = await create_record(
        app_client, table_id, ts=FIRST_MOMENT, values={"温度": 25}
    )

    record = created["record"]
    assert record["values"] == {"温度": 25.0}
    assert record["overrides"]["温度"]["value"] == 25.0
    assert record["overrides"]["温度"]["by_name"] == "测试员"


async def test_a_formula_column_cannot_be_written_by_hand(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="产量")
    await create_column(
        app_client,
        table["id"],
        key="双倍",
        source="formula",
        formula="{产量} * 2",
    )

    created = await create_record(
        app_client,
        str(table["id"]),
        ts=FIRST_MOMENT,
        values={"产量": 3, "双倍": 999},
    )

    assert created["record"]["computed"] == {"双倍": 6.0}
    assert "双倍" not in created["record"]["values"]


async def test_a_required_column_left_empty_is_a_client_error(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_table(app_client, key="产量", is_required=True)

    response = await app_client.post(
        records_url(table_id), json={"ts": FIRST_MOMENT, "values": {}}
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert code_of(response) == RECORD_INVALID


async def test_editing_one_column_keeps_the_collected_value(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 合并写而不是整体覆盖：整体覆盖会把点位汇总列的修正与采集原值一起抹掉
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="产量")
    await create_column(
        app_client, table["id"], key="温度", source="point", node_key=NODE_KEY
    )
    created = await create_record(
        app_client,
        str(table["id"]),
        ts=FIRST_MOMENT,
        values={"产量": 3, "温度": 25},
    )
    row_id = created["record"]["row_id"]

    response = await app_client.patch(
        record_url(str(table["id"]), row_id, FIRST_MOMENT),
        json={"values": {"产量": 8}},
    )

    record = data_of(response)["record"]
    assert record["values"] == {"产量": 8.0, "温度": 25.0}
    assert record["overrides"]["温度"]["value"] == 25.0


async def test_changing_the_data_time_keeps_the_row_identity(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ `ts` 是分区键，改它必须先删后插；`row_id` 与录入署名要原样带过去，
    # 否则前端持有的引用当场失效、而「谁录的」这笔账也换了人
    table_id = await seed_table(app_client)
    created = await create_record(
        app_client, table_id, ts=FIRST_MOMENT, values={"产量": 3}
    )
    row_id = created["record"]["row_id"]

    response = await app_client.patch(
        record_url(table_id, row_id, FIRST_MOMENT),
        json={"ts": SECOND_MOMENT, "values": {}},
    )

    moved = data_of(response)["record"]
    assert moved["row_id"] == row_id
    assert moved["ts"] == SECOND_MOMENT
    assert moved["created_by_name"] == "测试员"
    assert moved["values"] == {"产量": 3.0}


async def test_the_row_is_gone_from_its_old_partition_after_a_move(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_table(app_client)
    created = await create_record(
        app_client, table_id, ts=FIRST_MOMENT, values={"产量": 3}
    )
    row_id = created["record"]["row_id"]
    await app_client.patch(
        record_url(table_id, row_id, FIRST_MOMENT),
        json={"ts": SECOND_MOMENT, "values": {}},
    )

    listed = data_of(await app_client.get(records_url(table_id)))

    assert [item["ts"] for item in listed["items"]] == [SECOND_MOMENT]


async def test_a_missing_row_is_a_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_table(app_client)

    response = await app_client.patch(
        record_url(table_id, str(uuid7())), json={"values": {}}
    )

    assert response.status_code == HTTP_NOT_FOUND
    assert code_of(response) == RECORD_NOT_FOUND


async def test_deleting_a_row_reports_the_deleted_identity(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_table(app_client)
    created = await create_record(
        app_client, table_id, ts=FIRST_MOMENT, values={"产量": 3}
    )
    row_id = created["record"]["row_id"]

    response = await app_client.delete(
        record_url(table_id, row_id, FIRST_MOMENT)
    )

    assert data_of(response)["deleted_row_id"] == row_id


async def test_records_come_back_newest_first(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_table(app_client)
    await create_record(
        app_client, table_id, ts=FIRST_MOMENT, values={"产量": 1}
    )
    await create_record(
        app_client, table_id, ts=SECOND_MOMENT, values={"产量": 2}
    )

    listed = data_of(await app_client.get(records_url(table_id)))

    assert [item["ts"] for item in listed["items"]] == [
        SECOND_MOMENT,
        FIRST_MOMENT,
    ]


async def test_the_cursor_walks_the_whole_table_without_repeats(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 游标而不是页码：`dataset_records` 是持续写入的时序集合，页码分页会在
    # 翻页之间静默重复与漏行
    table_id = await seed_table(app_client)
    moments = [f"2026-08-23T1{hour}:00:00.000Z" for hour in range(5)]
    for moment in moments:
        await create_record(app_client, table_id, ts=moment, values={"产量": 1})

    seen: list[str] = []
    after: str | None = None
    while True:
        query = "" if after is None else f"&after={after}"
        page = data_of(
            await app_client.get(f"{records_url(table_id)}?limit=2{query}")
        )
        seen.extend(item["ts"] for item in page["items"])
        after = page["next"]
        if after is None:
            break

    assert sorted(seen) == sorted(moments)
    assert len(seen) == len(set(seen))


async def test_exactly_one_page_of_rows_is_not_reported_as_more(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 触顶判定多查一行：恰好只有 limit 行时数据是完整的，拿
    # `len(rows) == limit` 猜会把它误报成还有下一页
    table_id = await seed_table(app_client)
    for moment in (FIRST_MOMENT, SECOND_MOMENT):
        await create_record(app_client, table_id, ts=moment, values={"产量": 1})

    page = data_of(await app_client.get(f"{records_url(table_id)}?limit=2"))

    assert page["has_more"] is False
    assert page["next"] is None


async def test_a_time_filter_narrows_the_listing(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_table(app_client)
    for moment in (FIRST_MOMENT, SECOND_MOMENT):
        await create_record(app_client, table_id, ts=moment, values={"产量": 1})

    page = data_of(
        await app_client.get(f"{records_url(table_id)}?since={SECOND_MOMENT}")
    )

    assert [item["ts"] for item in page["items"]] == [SECOND_MOMENT]


async def test_a_malformed_time_filter_is_rejected_not_ignored(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 当成没给的话，一个写错格式的时间范围会静默退化成「不限」，而用户以为
    # 自己筛过了
    table_id = await seed_table(app_client)

    response = await app_client.get(f"{records_url(table_id)}?since=昨天")

    assert response.status_code == HTTP_BAD_REQUEST


async def test_writing_a_record_marks_the_table_dirty_after_it_commits(
    app_client: httpx.AsyncClient, dirty_marks: FakeSetSink
) -> None:
    # ⚠ 报脏走提交后钩子：提交前报，发布器抢先读到的是旧值，然后把它当新值
    # 推出去（docs/DATASET_DESIGN.md §16）
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="产量")
    assert dirty_marks.members(DIRTY_KEY) == set()

    await create_record(
        app_client, str(table["id"]), ts=FIRST_MOMENT, values={"产量": 1}
    )

    assert dirty_marks.members(DIRTY_KEY) == {table["code"]}


async def test_a_rejected_write_never_marks_the_table_dirty(
    app_context: AppContext, dirty_marks: FakeSetSink
) -> None:
    # ⚠ 回滚掉的事务不该在外面留下「它成功了」的痕迹
    client = app_context.client
    table = await create_table(client)
    await create_column(client, table["id"], key="产量", is_required=True)

    await client.post(records_url(str(table["id"])), json={"values": {}})

    assert dirty_marks.members(DIRTY_KEY) == set()
