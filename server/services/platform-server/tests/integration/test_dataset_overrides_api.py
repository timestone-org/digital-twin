"""人工修正：写、撤、按列批量撤销。

⚠ 这一层守的是三处分界：只有点位汇总列收得下修正（写错列当场报错而不是静默
忽略）、「提交为空」是撤销而不是改成空、以及改完修正必须跟着重算——不重算的话
表格会同时显示「修正后的原始值」与「按修正前的值算出来的公式值」。
"""

import httpx
import pytest
from unit.dataset_fakes import FakeSetSink

from integration.dataset_helpers import (
    DIRTY_KEY,
    HTTP_BAD_REQUEST,
    create_column,
    create_record,
    create_table,
    data_of,
    overrides_url,
)

pytestmark = pytest.mark.requires_postgres

NODE_KEY = "0192f0c0-0000-7000-8000-00000000abcd:outlet_temp"
MOMENT = "2026-08-23T10:00:00.000Z"


async def seed(client: httpx.AsyncClient) -> tuple[str, str, str]:
    """一张带点位汇总列的台账 + 一行数据；回 (表 id, 表 code, 行 id)。"""
    table = await create_table(client)
    await create_column(
        client, table["id"], key="温度", source="point", node_key=NODE_KEY
    )
    created = await create_record(client, str(table["id"]), ts=MOMENT)
    return str(table["id"]), str(table["code"]), created["record"]["row_id"]


async def test_a_correction_becomes_the_effective_value(
    app_client: httpx.AsyncClient,
) -> None:
    table_id, _code, row_id = await seed(app_client)

    response = await app_client.put(
        overrides_url(table_id, row_id, MOMENT),
        json={"values": {"温度": 25}, "reason": "仪表故障"},
    )

    record = data_of(response)["record"]
    assert record["values"] == {"温度": 25.0}
    assert record["overrides"]["温度"]["reason"] == "仪表故障"


async def test_a_manual_column_refuses_a_correction(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 静默忽略的话，用户改完看到的还是原值，而界面上没有任何东西说它没生效
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="产量")
    created = await create_record(app_client, str(table["id"]), ts=MOMENT)

    response = await app_client.put(
        overrides_url(str(table["id"]), created["record"]["row_id"], MOMENT),
        json={"values": {"产量": 9}},
    )

    assert response.status_code == HTTP_BAD_REQUEST


async def test_a_formula_column_refuses_a_correction(
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
    created = await create_record(app_client, str(table["id"]), ts=MOMENT)

    response = await app_client.put(
        overrides_url(str(table["id"]), created["record"]["row_id"], MOMENT),
        json={"values": {"双倍": 9}},
    )

    assert response.status_code == HTTP_BAD_REQUEST


async def test_an_unknown_column_refuses_a_correction(
    app_client: httpx.AsyncClient,
) -> None:
    table_id, _code, row_id = await seed(app_client)

    response = await app_client.put(
        overrides_url(table_id, row_id, MOMENT),
        json={"values": {"根本没有这一列": 1}},
    )

    assert response.status_code == HTTP_BAD_REQUEST


async def test_submitting_an_empty_value_revokes_and_says_so(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 回执必须把「改了几格」与「撤了几格」分开说：合成一个数的话，用户撤掉
    # 一格却会看到「已修正 1 格」
    table_id, _code, row_id = await seed(app_client)
    await app_client.put(
        overrides_url(table_id, row_id, MOMENT), json={"values": {"温度": 25}}
    )

    response = await app_client.put(
        overrides_url(table_id, row_id, MOMENT), json={"values": {"温度": ""}}
    )

    saved = data_of(response)
    assert saved["cleared"] == ["温度"]
    assert saved["record"]["overrides"] is None


async def test_a_correction_feeds_the_formula_that_reads_that_column(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 公式吃的是 effective：仪表故障那一格手填了实际值，派生列就必须按手填
    # 的值算，否则表格上两个数互相矛盾
    table = await create_table(app_client)
    await create_column(
        app_client, table["id"], key="温度", source="point", node_key=NODE_KEY
    )
    await create_column(
        app_client,
        table["id"],
        key="两倍温度",
        source="formula",
        formula="{温度} * 2",
    )
    created = await create_record(app_client, str(table["id"]), ts=MOMENT)
    row_id = created["record"]["row_id"]

    response = await app_client.put(
        overrides_url(str(table["id"]), row_id, MOMENT),
        json={"values": {"温度": 25}},
    )

    assert data_of(response)["record"]["computed"] == {"两倍温度": 50.0}


async def test_clearing_a_row_puts_the_formula_back_on_the_raw_value(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    await create_column(
        app_client, table["id"], key="温度", source="point", node_key=NODE_KEY
    )
    await create_column(
        app_client,
        table["id"],
        key="两倍温度",
        source="formula",
        formula="{温度} * 2",
    )
    created = await create_record(app_client, str(table["id"]), ts=MOMENT)
    row_id = created["record"]["row_id"]
    await app_client.put(
        overrides_url(str(table["id"]), row_id, MOMENT),
        json={"values": {"温度": 25}},
    )

    response = await app_client.delete(
        overrides_url(str(table["id"]), row_id, MOMENT)
    )

    saved = data_of(response)
    assert saved["cleared"] == ["温度"]
    assert saved["record"]["computed"] == {"两倍温度": None}


async def test_clearing_a_row_without_corrections_says_so(
    app_client: httpx.AsyncClient,
) -> None:
    table_id, _code, row_id = await seed(app_client)

    response = await app_client.delete(overrides_url(table_id, row_id, MOMENT))

    assert response.json()["message"] == "该行没有人工修正"
    assert data_of(response)["cleared"] == []


async def test_clearing_only_the_named_keys_leaves_the_others(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    for key, node in (("温度", NODE_KEY), ("湿度", f"{NODE_KEY}2")):
        await create_column(
            app_client, table["id"], key=key, source="point", node_key=node
        )
    created = await create_record(app_client, str(table["id"]), ts=MOMENT)
    row_id = created["record"]["row_id"]
    await app_client.put(
        overrides_url(str(table["id"]), row_id, MOMENT),
        json={"values": {"温度": 25, "湿度": 40}},
    )

    response = await app_client.request(
        "DELETE",
        overrides_url(str(table["id"]), row_id, MOMENT),
        json={"keys": ["温度"]},
    )

    assert set(data_of(response)["record"]["overrides"]) == {"湿度"}


async def test_a_bulk_clear_sweeps_the_named_column_over_a_range(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    await create_column(
        app_client, table["id"], key="温度", source="point", node_key=NODE_KEY
    )
    moments = [f"2026-08-23T1{hour}:00:00.000Z" for hour in range(3)]
    for moment in moments:
        created = await create_record(
            app_client, str(table["id"]), ts=moment, values={"温度": 25}
        )
        assert created["record"]["overrides"] is not None

    response = await app_client.post(
        f"/api/v1/platform/dataset-tables/{table['id']}/overrides:clear",
        json={"column_keys": ["温度"], "since": moments[1]},
    )

    outcome = data_of(response)
    assert (outcome["cleared_rows"], outcome["cleared_cells"]) == (2, 2)


async def test_a_bulk_clear_of_an_unknown_column_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    table_id, _code, _row_id = await seed(app_client)

    response = await app_client.post(
        f"/api/v1/platform/dataset-tables/{table_id}/overrides:clear",
        json={"column_keys": ["根本没有这一列"]},
    )

    assert response.status_code == HTTP_BAD_REQUEST


async def test_writing_a_correction_marks_the_table_dirty(
    app_client: httpx.AsyncClient, dirty_marks: FakeSetSink
) -> None:
    table_id, code, row_id = await seed(app_client)
    dirty_marks.sets.clear()

    await app_client.put(
        overrides_url(table_id, row_id, MOMENT), json={"values": {"温度": 25}}
    )

    assert dirty_marks.members(DIRTY_KEY) == {code}


async def test_the_bulk_clear_receipt_names_the_rows_it_recomputed(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 撤销之后必须跟着重算：不重算的话表格会同时显示「撤销后的原始值」与
    # 「按修正值算出来的公式值」，回执要把重算那一段也说出来
    table = await create_table(app_client)
    await create_column(
        app_client, table["id"], key="温度", source="point", node_key=NODE_KEY
    )
    await create_column(
        app_client,
        table["id"],
        key="两倍温度",
        source="formula",
        formula="{温度} * 2",
    )
    await create_record(
        app_client, str(table["id"]), ts=MOMENT, values={"温度": 25}
    )

    response = await app_client.post(
        f"/api/v1/platform/dataset-tables/{table['id']}/overrides:clear",
        json={"column_keys": ["温度"]},
    )

    outcome = data_of(response)
    assert (outcome["cleared_rows"], outcome["recomputed"]) == (1, 1)
    assert "重算 1 行" in response.json()["message"]
