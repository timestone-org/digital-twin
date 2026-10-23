"""自然日合计从 HTTP 录入、预取到区间重算的集成口径。"""

from typing import Any

import httpx
import pytest

from integration.dataset_helpers import (
    HTTP_BAD_REQUEST,
    HTTP_OK,
    TABLES,
    create_column,
    create_record,
    create_table,
    data_of,
    record_url,
)
from platform_server.apps.dataset.services import record_history

pytestmark = pytest.mark.requires_postgres

YESTERDAY = "2026-10-22T15:55:00Z"
MIDNIGHT = "2026-10-22T16:00:00Z"
FIVE_MINUTES = "2026-10-22T16:05:00Z"
TEN_MINUTES = "2026-10-22T16:10:00Z"


async def daily_table(client: httpx.AsyncClient) -> str:
    """建立带当日普通与完整合计的表。Args: client。"""
    table = await create_table(client)
    table_id = str(table["id"])
    await create_column(client, table_id, key="电量", name="电量")
    for key, formula in (
        ("普通日和", "SUM_OVER({电量}, 'today')"),
        ("完整日和", "SUM_COMPLETE_OVER({电量}, 'today', 300)"),
    ):
        await create_column(
            client,
            table_id,
            key=key,
            name=key,
            source="formula",
            formula=formula,
        )
    return table_id


async def record(
    client: httpx.AsyncClient, table_id: str, moment: str, **values: Any
) -> dict[str, Any]:
    """录入后返回生效行。Args: client, table_id, moment, values。"""
    created = await create_record(client, table_id, ts=moment, values=values)
    return dict(created["record"])


async def test_single_row_compute_loads_the_local_midnight_bucket(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await daily_table(app_client)
    await record(app_client, table_id, YESTERDAY, 电量=90)
    await record(app_client, table_id, MIDNIGHT, 电量=2)

    current = await record(app_client, table_id, FIVE_MINUTES, 电量=3)

    assert current["computed"] == {"普通日和": 5.0, "完整日和": 5.0}


async def test_missing_cells_do_not_become_a_complete_day_total(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await daily_table(app_client)
    await record(app_client, table_id, MIDNIGHT, 电量=2)
    await record(app_client, table_id, FIVE_MINUTES)

    current = await record(app_client, table_id, TEN_MINUTES, 电量=4)

    assert current["computed"] == {"普通日和": 6.0, "完整日和": None}


async def test_recomputing_a_tail_keeps_all_of_todays_earlier_buckets(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await daily_table(app_client)
    first = await record(app_client, table_id, MIDNIGHT, 电量=2)
    await record(app_client, table_id, FIVE_MINUTES, 电量=3)
    await record(app_client, table_id, TEN_MINUTES, 电量=4)
    changed = await app_client.patch(
        record_url(table_id, first["row_id"], MIDNIGHT),
        json={"values": {"电量": 7}},
    )
    assert changed.status_code == HTTP_OK

    response = await app_client.post(
        f"{TABLES}/{table_id}:recompute", json={"since": TEN_MINUTES}
    )
    latest = data_of(await app_client.get(f"{TABLES}/{table_id}/latest"))

    assert response.status_code == HTTP_OK
    assert data_of(response)["recomputed"] == 1
    assert latest["computed"] == {"普通日和": 14.0, "完整日和": 14.0}


async def test_cross_table_day_totals_include_zero_clock_and_exclude_yesterday(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_table(
        app_client, code="energy_source", name="能量来源"
    )
    await create_column(app_client, source["id"], key="电量", name="电量")
    for moment, value in ((YESTERDAY, 90), (MIDNIGHT, 2), (FIVE_MINUTES, 3)):
        await record(app_client, source["id"], moment, 电量=value)
    target = await create_table(
        app_client, code="energy_total", name="能量合计"
    )
    await create_column(
        app_client,
        target["id"],
        key="日合计",
        name="日合计",
        source="formula",
        formula="SUM_COMPLETE_OVER({energy_source.电量}, 'today', 300)",
    )

    current = await record(app_client, target["id"], FIVE_MINUTES)

    assert current["computed"] == {"日合计": 5.0}


async def test_a_counter_reset_keeps_the_daily_total_unknown(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    await create_column(
        app_client, table["id"], key="累计电量", name="累计电量"
    )
    await create_column(
        app_client,
        table["id"],
        key="增量",
        name="增量",
        source="formula",
        formula=(
            "IF({累计电量} < PREV({累计电量}), None, "
            "{累计电量} - PREV({累计电量}))"
        ),
    )
    await create_column(
        app_client,
        table["id"],
        key="当日电量",
        name="当日电量",
        source="formula",
        formula="SUM_COMPLETE_OVER({增量}, 'today', 300)",
    )
    for moment, value in ((YESTERDAY, 100), (MIDNIGHT, 102), (FIVE_MINUTES, 1)):
        await record(app_client, table["id"], moment, 累计电量=value)

    current = await record(app_client, table["id"], TEN_MINUTES, 累计电量=4)

    assert current["computed"] == {"增量": 3.0, "当日电量": None}


async def test_recomputing_from_midnight_keeps_the_previous_meter_reading(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    await create_column(
        app_client, table["id"], key="累计电量", name="累计电量"
    )
    await create_column(
        app_client,
        table["id"],
        key="增量",
        name="增量",
        source="formula",
        formula="{累计电量} - PREV({累计电量})",
    )
    await create_column(
        app_client,
        table["id"],
        key="当日电量",
        name="当日电量",
        source="formula",
        formula="SUM_COMPLETE_OVER({增量}, 'today', 300)",
    )
    for moment, value in (
        (YESTERDAY, 100),
        (MIDNIGHT, 102),
        (FIVE_MINUTES, 105),
    ):
        await record(app_client, table["id"], moment, 累计电量=value)

    response = await app_client.post(
        f"{TABLES}/{table['id']}:recompute", json={"since": MIDNIGHT}
    )
    latest = data_of(await app_client.get(f"{TABLES}/{table['id']}/latest"))

    assert response.status_code == HTTP_OK
    assert latest["computed"] == {"增量": 3.0, "当日电量": 5.0}


async def test_history_prefetch_limit_is_an_explicit_failure(
    app_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    table_id = await daily_table(app_client)
    for moment, value in ((MIDNIGHT, 2), (FIVE_MINUTES, 3), (TEN_MINUTES, 4)):
        await record(app_client, table_id, moment, 电量=value)
    monkeypatch.setattr(record_history, "MAX_FORMULA_HISTORY_ROWS", 2)

    response = await app_client.post(
        f"{TABLES}/{table_id}/records",
        json={"ts": "2026-10-22T16:15:00Z", "values": {"电量": 5}},
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert "历史预取超过" in response.json()["message"]


async def test_a_history_window_at_exactly_the_limit_still_computes(
    app_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    table_id = await daily_table(app_client)
    await record(app_client, table_id, MIDNIGHT, 电量=2)
    monkeypatch.setattr(record_history, "MAX_FORMULA_HISTORY_ROWS", 1)

    current = await record(app_client, table_id, FIVE_MINUTES, 电量=3)

    assert current["computed"] == {"普通日和": 5.0, "完整日和": 5.0}


async def test_recompute_seeds_refuse_a_truncated_history_window(
    app_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    table_id = await daily_table(app_client)
    for moment, value in ((MIDNIGHT, 2), (FIVE_MINUTES, 3), (TEN_MINUTES, 4)):
        await record(app_client, table_id, moment, 电量=value)
    monkeypatch.setattr(record_history, "MAX_FORMULA_HISTORY_ROWS", 1)

    response = await app_client.post(
        f"{TABLES}/{table_id}:recompute", json={"since": TEN_MINUTES}
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert "历史预取超过" in response.json()["message"]


async def test_cross_table_windows_refuse_a_truncated_history_window(
    app_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = await create_table(
        app_client, code="energy_source", name="能量来源"
    )
    await create_column(app_client, source["id"], key="电量", name="电量")
    await record(app_client, source["id"], MIDNIGHT, 电量=2)
    await record(app_client, source["id"], FIVE_MINUTES, 电量=3)
    target = await create_table(
        app_client, code="energy_total", name="能量合计"
    )
    await create_column(
        app_client,
        target["id"],
        key="日合计",
        name="日合计",
        source="formula",
        formula="SUM_COMPLETE_OVER({energy_source.电量}, 'today', 300)",
    )
    monkeypatch.setattr(record_history, "MAX_FORMULA_HISTORY_ROWS", 1)

    response = await app_client.post(
        f"{TABLES}/{target['id']}/records",
        json={"ts": FIVE_MINUTES, "values": {}},
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert "历史预取超过" in response.json()["message"]
