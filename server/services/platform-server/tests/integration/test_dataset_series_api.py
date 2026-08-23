"""取数面：最新一行、时间序列、重算，以及公式取历史的四条链路。

⚠ 这一层守的是三件事：序列的截断口径（留最新那批、多查一行判触顶）、
`PREV` / 时间窗 / 整表聚合 / 跨表引用四类取数一个都不许漏装（漏装的表现是那一类
引用静默算空），以及改历史行之后的 `has_stale_downstream` 上报。
"""

import httpx
import pytest
from unit.dataset_fakes import FakeSetSink

from integration.dataset_helpers import (
    DIRTY_KEY,
    TABLES,
    create_column,
    create_record,
    create_table,
    data_of,
)

pytestmark = pytest.mark.requires_postgres

NODE_KEY = "0192f0c0-0000-7000-8000-00000000abcd:outlet_temp"
HOURS = [f"2026-08-23T0{hour}:00:00.000Z" for hour in range(1, 5)]


def latest_url(table_id: str) -> str:
    """最后一行的地址。"""
    return f"{TABLES}/{table_id}/latest"


def series_url(table_id: str, keys: str) -> str:
    """序列的地址。"""
    return f"{TABLES}/{table_id}/series?keys={keys}"


async def seed_hourly(
    client: httpx.AsyncClient, values: list[float], **column: object
) -> str:
    """建一张台账、按小时录入若干行；回台账 id。"""
    table = await create_table(client)
    await create_column(client, table["id"], key="产量", **column)
    for moment, value in zip(HOURS, values, strict=False):
        await create_record(
            client, str(table["id"]), ts=moment, values={"产量": value}
        )
    return str(table["id"])


async def test_latest_gives_the_newest_row(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_hourly(app_client, [1.0, 2.0, 3.0])

    latest = data_of(await app_client.get(latest_url(table_id)))

    assert latest["ts"] == HOURS[2]
    assert latest["values"] == {"产量": 3.0}


async def test_latest_on_an_empty_table_is_not_an_error(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 空表回 404 的话，大屏刚绑好一张还没出数的台账就会显示成「取不到」
    table = await create_table(app_client)

    latest = data_of(await app_client.get(latest_url(str(table["id"]))))

    assert latest == {"ts": None, "values": {}, "computed": {}}


async def test_latest_reports_the_corrected_value(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 大屏上显示的必须是人工修正之后那个数，否则现场看到的与台账里看到的
    # 是两个数
    table = await create_table(app_client)
    await create_column(
        app_client, table["id"], key="温度", source="point", node_key=NODE_KEY
    )
    await create_record(
        app_client, str(table["id"]), ts=HOURS[0], values={"温度": 25}
    )

    latest = data_of(await app_client.get(latest_url(str(table["id"]))))

    assert latest["values"] == {"温度": 25.0}


async def test_a_series_comes_back_oldest_first(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_hourly(app_client, [1.0, 2.0, 3.0])

    result = data_of(await app_client.get(series_url(table_id, "产量")))

    assert [point["ts"] for point in result["series"]["产量"]] == HOURS[:3]
    assert result["is_truncated"] is False


async def test_a_series_of_exactly_the_limit_is_not_truncated(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 触顶靠多查一行判定：拿 `len(rows) == limit` 猜的话，恰好取满的一次
    # 查询会被误报成截断，用户于是被劝去缩小一个根本不需要缩的时间范围
    table_id = await seed_hourly(app_client, [1.0, 2.0, 3.0])

    result = data_of(await app_client.get(series_url(table_id, "产量")))

    assert result["is_truncated"] is False
    assert len(result["series"]["产量"]) == 3


async def test_a_series_without_keys_is_a_client_error(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_hourly(app_client, [1.0])

    response = await app_client.get(f"{TABLES}/{table_id}/series?keys=")

    assert response.status_code == 400


async def test_a_series_skips_the_periods_that_have_no_value(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 空桶不填 0、不结转：结转会让断采期间的曲线看起来一切正常
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="产量")
    await create_record(app_client, str(table["id"]), ts=HOURS[0])
    await create_record(
        app_client, str(table["id"]), ts=HOURS[1], values={"产量": 2}
    )

    result = data_of(await app_client.get(series_url(str(table["id"]), "产量")))

    assert [point["value"] for point in result["series"]["产量"]] == [2.0]


async def test_a_previous_row_reference_reads_the_row_before_it(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 跨行取数漏装的话，PREV 会静默算空，而界面上它与「上一行确实没值」
    # 分不开
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="读数")
    await create_column(
        app_client,
        table["id"],
        key="增量",
        source="formula",
        formula="{读数} - PREV({读数})",
    )
    for moment, value in zip(HOURS[:2], [10, 25], strict=True):
        created = await create_record(
            app_client, str(table["id"]), ts=moment, values={"读数": value}
        )

    assert created["record"]["computed"] == {"增量": 15.0}


async def test_a_window_aggregate_covers_the_rows_inside_it(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="产量")
    await create_column(
        app_client,
        table["id"],
        key="近三小时",
        source="formula",
        formula="SUM_OVER({产量}, '3h')",
    )
    for moment, value in zip(HOURS[:3], [1, 2, 3], strict=True):
        created = await create_record(
            app_client, str(table["id"]), ts=moment, values={"产量": value}
        )

    assert created["record"]["computed"] == {"近三小时": 6.0}


async def test_a_whole_table_aggregate_sees_every_row(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 整表聚合走库里的一条聚合语句，它的三层取值必须与 effective 同口径；
    # 漏装的话 `MAX_ALL` 恒为空，而那一列在界面上只是「没算出来」
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="产量")
    await create_column(
        app_client,
        table["id"],
        key="最大值",
        source="formula",
        formula="MAX_ALL({产量})",
    )
    for moment, value in zip(HOURS[:3], [5, 9, 2], strict=True):
        created = await create_record(
            app_client, str(table["id"]), ts=moment, values={"产量": value}
        )

    assert created["record"]["computed"] == {"最大值": 9.0}


async def test_a_whole_table_aggregate_reads_the_corrected_value(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 库里那份 SQL 的三层取值与 service/effective.py 必须一致：分叉的表现是
    # 「表格上这一格显示 25，而 MAX_ALL 算的是 20」
    table = await create_table(app_client)
    await create_column(
        app_client, table["id"], key="温度", source="point", node_key=NODE_KEY
    )
    await create_column(
        app_client,
        table["id"],
        key="最大值",
        source="formula",
        formula="MAX_ALL({温度})",
    )
    created = await create_record(
        app_client, str(table["id"]), ts=HOURS[0], values={"温度": 25}
    )

    assert created["record"]["computed"] == {"最大值": 25.0}


async def test_a_cross_table_reference_reads_the_other_ledger(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 跨表取数漏装的话，那一列静默算空，而两张表单看都正常
    source = await create_table(app_client, code="water", name="水量")
    await create_column(app_client, source["id"], key="进水")
    await create_record(
        app_client, str(source["id"]), ts=HOURS[0], values={"进水": 40}
    )
    target = await create_table(app_client, code="energy", name="能耗")
    await create_column(
        app_client,
        target["id"],
        key="折算",
        source="formula",
        formula="{water.进水} / 2",
    )

    created = await create_record(app_client, str(target["id"]), ts=HOURS[1])

    assert created["record"]["computed"] == {"折算": 20.0}


async def test_editing_a_historical_row_reports_stale_downstream(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 只上报不级联：级联的边界在最坏情况下是整表，而它由一次单行编辑触发
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="读数")
    await create_column(
        app_client,
        table["id"],
        key="增量",
        source="formula",
        formula="{读数} - PREV({读数})",
    )
    first = await create_record(
        app_client, str(table["id"]), ts=HOURS[0], values={"读数": 10}
    )
    await create_record(
        app_client, str(table["id"]), ts=HOURS[1], values={"读数": 25}
    )

    response = await app_client.patch(
        f"{TABLES}/{table['id']}/records/{first['record']['row_id']}"
        f"?ts={HOURS[0]}",
        json={"values": {"读数": 12}},
    )

    assert data_of(response)["has_stale_downstream"] is True


async def test_a_table_without_history_formulas_never_goes_stale(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_hourly(app_client, [1.0, 2.0])

    created = await create_record(
        app_client, table_id, ts=HOURS[2], values={"产量": 3}
    )

    assert created["has_stale_downstream"] is False


async def test_recompute_repairs_the_stale_downstream_rows(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="读数")
    await create_column(
        app_client,
        table["id"],
        key="增量",
        source="formula",
        formula="{读数} - PREV({读数})",
    )
    first = await create_record(
        app_client, str(table["id"]), ts=HOURS[0], values={"读数": 10}
    )
    await create_record(
        app_client, str(table["id"]), ts=HOURS[1], values={"读数": 25}
    )
    await app_client.patch(
        f"{TABLES}/{table['id']}/records/{first['record']['row_id']}"
        f"?ts={HOURS[0]}",
        json={"values": {"读数": 12}},
    )

    outcome = data_of(
        await app_client.post(f"{TABLES}/{table['id']}:recompute", json={})
    )
    series = data_of(await app_client.get(series_url(str(table["id"]), "增量")))

    assert (outcome["recomputed"], outcome["failed"]) == (2, 0)
    assert [point["value"] for point in series["series"]["增量"]] == [13.0]


async def test_recompute_on_a_table_without_formulas_does_nothing(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await seed_hourly(app_client, [1.0])

    outcome = data_of(
        await app_client.post(f"{TABLES}/{table_id}:recompute", json={})
    )

    assert outcome == {
        "recomputed": 0,
        "failed": 0,
        "is_truncated": False,
        "limit": 200000,
    }


async def test_recompute_marks_the_table_dirty(
    app_client: httpx.AsyncClient, dirty_marks: FakeSetSink
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
    await create_record(
        app_client, str(table["id"]), ts=HOURS[0], values={"产量": 1}
    )
    dirty_marks.sets.clear()

    await app_client.post(f"{TABLES}/{table['id']}:recompute", json={})

    assert dirty_marks.members(DIRTY_KEY) == {table["code"]}


async def test_a_failing_formula_only_poisons_its_own_cell(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 一条写坏的公式不该让整行——乃至整批重算——失败：那一格记一条原因，
    # 别的列照常出数
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="产量")
    await create_column(app_client, table["id"], key="班次", data_type="string")
    await create_column(
        app_client,
        table["id"],
        key="算不出",
        source="formula",
        formula="{班次} * 2",
    )
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
        ts=HOURS[0],
        values={"产量": 3, "班次": "早班"},
    )

    record = created["record"]
    assert record["computed"]["双倍"] == 6.0
    assert record["computed"]["算不出"] is None
    assert "算不出" in record["compute_error"]


async def test_a_whole_table_aggregate_over_a_formula_column_converges(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ `*_ALL` 指向另一个公式列时，头一趟折算进去的还是空：不多跑几趟的话，
    # 这一列永远比真实值少算当前行那一份
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="产量")
    await create_column(
        app_client,
        table["id"],
        key="双倍",
        source="formula",
        formula="{产量} * 2",
    )
    await create_column(
        app_client,
        table["id"],
        key="双倍最大",
        source="formula",
        formula="MAX_ALL({双倍})",
    )

    created = await create_record(
        app_client, str(table["id"]), ts=HOURS[0], values={"产量": 3}
    )

    assert created["record"]["computed"]["双倍最大"] == 6.0


async def test_recompute_over_an_empty_range_touches_nothing(
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
    await create_record(
        app_client, str(table["id"]), ts=HOURS[0], values={"产量": 1}
    )

    outcome = data_of(
        await app_client.post(
            f"{TABLES}/{table['id']}:recompute", json={"since": HOURS[3]}
        )
    )

    assert (outcome["recomputed"], outcome["is_truncated"]) == (0, False)


async def test_recomputing_a_tail_range_still_sees_the_rows_before_it(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 种子行不能省：少了它，区间里最早那几行的时间窗会算成空——而它们在库里
    # 明明有上文，只是这一趟没取进来
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="产量")
    await create_column(
        app_client,
        table["id"],
        key="近三小时",
        source="formula",
        formula="SUM_OVER({产量}, '3h')",
    )
    for moment, value in zip(HOURS[:3], [1, 2, 3], strict=True):
        await create_record(
            app_client, str(table["id"]), ts=moment, values={"产量": value}
        )

    await app_client.post(
        f"{TABLES}/{table['id']}:recompute", json={"since": HOURS[2]}
    )
    series = data_of(
        await app_client.get(series_url(str(table["id"]), "近三小时"))
    )

    assert [point["value"] for point in series["series"]["近三小时"]] == [
        1.0,
        3.0,
        6.0,
    ]


async def test_the_recompute_receipt_names_the_rows_that_failed(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 求值出错要说出来：只回「已重算 N 行」的话，一批算不出数的行看起来
    # 与算对了的一模一样
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="班次", data_type="string")
    await create_column(
        app_client,
        table["id"],
        key="算不出",
        source="formula",
        formula="{班次} * 2",
    )
    await create_record(
        app_client, str(table["id"]), ts=HOURS[0], values={"班次": "早班"}
    )

    response = await app_client.post(
        f"{TABLES}/{table['id']}:recompute", json={}
    )

    assert data_of(response)["failed"] == 1
    assert "求值错误" in response.json()["message"]
