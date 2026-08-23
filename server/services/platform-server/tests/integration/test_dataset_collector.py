"""聚合采集器对着真库跑一拍：八档 SQL 折出来的格与幂等写。

⚠ 这一层必须打真库：`time_bucket(…, timezone => …)`、`last(v, ts) FILTER (…)`
与 `jsonb || (EXCLUDED - text[])` 三样都只有真跑一遍才作数——拿假件断言 SQL
文本的单元用例对「函数解析不到」「参数类型不对」这类失败**完全无感**。
调度、水位与报脏那几条在 `test_dataset_collector_edges.py`。
"""

from datetime import timedelta

import pytest
from conftest import AppContext

from integration.collector_helpers import (
    CLOSED,
    HOUR,
    NOW,
    POINT,
    aggregate_table,
    rows_of,
    run_pass,
    set_watermark,
    watermark_of,
)
from integration.dataset_helpers import (
    ArchiveWriter,
    Sample,
    create_column,
    records_url,
)
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog

pytestmark = pytest.mark.requires_postgres


async def test_a_closed_bucket_becomes_one_row_with_its_sample_count(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    await archive.write(
        POINT,
        [
            Sample(ts=CLOSED + timedelta(minutes=5), value_num=10.0),
            Sample(ts=CLOSED + timedelta(minutes=25), value_num=20.0),
            Sample(ts=CLOSED + timedelta(minutes=45), value_num=30.0),
        ],
    )
    outcome = await run_pass(
        app_context, (dirty, archive), table_id=table["id"]
    )
    assert outcome is not None
    assert outcome.written == 1
    rows = await rows_of(app_context.client, table["id"])
    assert len(rows) == 1
    assert rows[0]["values"]["均温"] == 20.0
    # ⚠ 样本数不是装饰：3 个样本的均值与 3600 个样本的均值在界面上一模一样
    assert rows[0]["samples"]["均温"] == 3
    assert rows[0]["source"] == "collect"


async def test_the_still_open_bucket_is_never_written(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    # ⚠ 当前这个桶还在收数：现在折算出来的是半截的数，而它会被下一拍原地改掉，
    # 图上表现为最后一格反复跳
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    await archive.write(
        POINT, [Sample(ts=NOW - timedelta(minutes=1), value_num=99.0)]
    )
    await run_pass(app_context, (dirty, archive), table_id=table["id"])
    assert await rows_of(app_context.client, table["id"]) == []
    # 水位仍然推到最后一个已关闭的桶：那个桶确实算过了，只是一格都没算出来
    assert await watermark_of(app_context, table["id"]) == CLOSED


async def test_running_twice_updates_the_same_row(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    # ⚠ 行标识由桶身份 uuid5 派生（D2）：构造式一变，每个历史桶就会再长出一行
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    await archive.write(
        POINT, [Sample(ts=CLOSED + timedelta(minutes=5), value_num=10.0)]
    )
    await run_pass(app_context, (dirty, archive), table_id=table["id"])
    first = await rows_of(app_context.client, table["id"])
    await archive.write(
        POINT, [Sample(ts=CLOSED + timedelta(minutes=50), value_num=30.0)]
    )
    await run_pass(app_context, (dirty, archive), table_id=table["id"], tail=1)
    second = await rows_of(app_context.client, table["id"])
    assert len(second) == 1
    assert second[0]["row_id"] == first[0]["row_id"]
    # 迟到的样本被尾部重算吃进来了
    assert second[0]["values"]["均温"] == 20.0
    assert second[0]["samples"]["均温"] == 2


async def test_a_manual_correction_survives_the_next_pass(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    # ⚠ 人工修正独占 `overrides_json`，采集与重算绝不覆盖（D4）
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    await archive.write(
        POINT, [Sample(ts=CLOSED + timedelta(minutes=5), value_num=10.0)]
    )
    await run_pass(app_context, (dirty, archive), table_id=table["id"])
    row = (await rows_of(app_context.client, table["id"]))[0]
    fixed = await app_context.client.put(
        f"{records_url(table['id'])}/{row['row_id']}/overrides",
        json={"values": {"均温": 77.0}, "reason": "现场核对"},
    )
    assert fixed.status_code == 200, fixed.text
    await run_pass(app_context, (dirty, archive), table_id=table["id"], tail=1)
    after = (await rows_of(app_context.client, table["id"]))[0]
    # 出参里的 values 已经是 effective：修正值仍然优先
    assert after["values"]["均温"] == 77.0
    assert after["overrides"]["均温"]["value"] == 77.0


async def test_a_typed_manual_value_is_not_overwritten_by_its_default(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    # ⚠ 采集入参里带着人工录入列的默认值，那是给**新建**的行用的；更新时不把
    # 这些键减掉，就是每一拍都拿默认值盖掉人填的数
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    await create_column(
        app_context.client,
        table["id"],
        key="班次",
        name="班次",
        data_type="string",
        default_value="早班",
    )
    await archive.write(
        POINT, [Sample(ts=CLOSED + timedelta(minutes=5), value_num=10.0)]
    )
    await run_pass(app_context, (dirty, archive), table_id=table["id"])
    row = (await rows_of(app_context.client, table["id"]))[0]
    assert row["values"]["班次"] == "早班"
    typed = await app_context.client.patch(
        f"{records_url(table['id'])}/{row['row_id']}",
        json={"values": {"班次": "夜班"}},
    )
    assert typed.status_code == 200, typed.text
    await run_pass(app_context, (dirty, archive), table_id=table["id"], tail=1)
    after = (await rows_of(app_context.client, table["id"]))[0]
    assert after["values"]["班次"] == "夜班"


async def test_a_bucket_with_no_samples_gets_no_row_at_all(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    # ⚠ 空桶 → 不写行，绝不填 0、绝不结转上一桶（D3）
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    await archive.write(
        POINT,
        [
            Sample(ts=CLOSED - HOUR * 2 + timedelta(minutes=5), value_num=1.0),
            Sample(ts=CLOSED + timedelta(minutes=5), value_num=3.0),
        ],
    )
    await set_watermark(app_context, table["id"], CLOSED - HOUR * 3)
    await run_pass(app_context, (dirty, archive), table_id=table["id"])
    stamps = [
        row["ts"] for row in await rows_of(app_context.client, table["id"])
    ]
    assert len(stamps) == 2


async def test_delta_reaches_across_the_bucket_boundary(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    """`delta` 是跨桶的：本桶末值 − 上一桶末值（§4.4）。

    ⚠ 桶内 `last − first` 会漏掉「上一桶末值 → 本桶首值」那一段，对累计量是
    系统性少算；一个桶里只有一个样本时更是直接算成 0。
    """
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="用电量",
        name="用电量",
        source="point",
        node_key=archive.node_key(POINT),
        agg="delta",
    )
    await archive.write(
        POINT,
        [
            Sample(ts=CLOSED - HOUR + timedelta(minutes=30), value_num=100.0),
            Sample(ts=CLOSED + timedelta(minutes=30), value_num=130.0),
        ],
    )
    await set_watermark(app_context, table["id"], CLOSED - HOUR)
    await run_pass(app_context, (dirty, archive), table_id=table["id"])
    rows = await rows_of(app_context.client, table["id"])
    assert rows[-1]["values"]["用电量"] == 30.0


async def test_delta_without_a_previous_end_stays_blank(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    # ⚠ 绝不拿本桶的 first 顶替：那是无声退化回旧口径，界面上看不出来
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="用电量",
        name="用电量",
        source="point",
        node_key=archive.node_key(POINT),
        agg="delta",
    )
    await archive.write(
        POINT,
        [
            Sample(ts=CLOSED + timedelta(minutes=5), value_num=100.0),
            Sample(ts=CLOSED + timedelta(minutes=55), value_num=130.0),
        ],
    )
    await run_pass(app_context, (dirty, archive), table_id=table["id"])
    assert await rows_of(app_context.client, table["id"]) == []


async def test_a_text_point_on_a_numeric_mode_is_blank_and_does_not_stop(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    # 一列配错不该让整张表的采集永久中断：那一格空着，别的列照常出数
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="状态均值",
        name="状态均值",
        source="point",
        node_key=archive.node_key("run_state"),
        agg="avg",
    )
    await create_column(
        app_context.client,
        table["id"],
        key="状态",
        name="状态",
        data_type="string",
        source="point",
        node_key=archive.node_key("run_state"),
        agg="last",
    )
    await archive.write(
        "run_state",
        [Sample(ts=CLOSED + timedelta(minutes=5), value_text="运行")],
    )
    await run_pass(app_context, (dirty, archive), table_id=table["id"])
    row = (await rows_of(app_context.client, table["id"]))[0]
    assert row["values"]["状态"] == "运行"
    assert row["values"].get("状态均值") is None


async def test_the_formula_columns_are_recomputed_for_what_was_written(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    # 不重算的话，表格会同时显示这一拍新采的原始值与上一拍算出来的公式值
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    await create_column(
        app_context.client,
        table["id"],
        key="翻倍",
        name="翻倍",
        source="formula",
        formula="{均温} * 2",
    )
    await archive.write(
        POINT, [Sample(ts=CLOSED + timedelta(minutes=5), value_num=21.0)]
    )
    await run_pass(app_context, (dirty, archive), table_id=table["id"])
    row = (await rows_of(app_context.client, table["id"]))[0]
    # ⚠ 公式结果落在 `computed` 而不是 `values`：原始值与计算值分列存，
    # 改公式重算只覆盖后者（§4.3a）
    assert row["computed"]["翻倍"] == 42.0
