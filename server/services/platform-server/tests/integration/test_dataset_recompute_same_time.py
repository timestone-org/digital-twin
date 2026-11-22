"""同刻并列的 PREV 与窗口在单行和批量重算中的 PostgreSQL 契约。"""

from collections.abc import Mapping
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from conftest import AppContext

from integration.dataset_helpers import (
    create_column,
    create_record,
    create_table,
    data_of,
    records_url,
    run_recompute,
)
from platform_server.apps.dataset.crud import column_crud, record_crud
from platform_server.apps.dataset.services import record_compute
from platform_server.apps.dataset.services.effective import effective_values
from platform_server.apps.dataset.services.record_history import RowTarget

pytestmark = pytest.mark.requires_postgres
FIRST = "2026-01-01T16:00:00Z"
TIED = "2026-01-01T16:10:00Z"
LAST = "2026-01-01T16:20:00Z"


async def _table(context: AppContext) -> str:
    """建立带有本表历史和公式缓存引用的台账。Args: context。"""
    table = await create_table(context.client)
    table_id = str(table["id"])
    await create_column(context.client, table_id, key="reading")
    formulas = (
        ("double", "{reading} * 2"),
        ("prior", "PREV({reading})"),
        ("prior2", "PREV({reading}, 2)"),
        ("sum", "SUM_OVER({reading}, '1h')"),
        ("count", "COUNT_OVER({reading}, '1h')"),
        ("last", "LAST_OVER({reading}, '1h')"),
        ("same_first", "FIRST_OVER({reading}, '5m')"),
        ("min", "MIN_OVER({reading}, '1h')"),
        ("max", "MAX_OVER({reading}, '1h')"),
        ("average", "AVG_OVER({reading}, '1h')"),
        ("formula_sum", "SUM_OVER({double}, '1h')"),
        ("whole", "SUM_ALL({double})"),
        ("complete", "SUM_COMPLETE_OVER({reading}, 'today', 600)"),
    )
    for key, formula in formulas:
        await create_column(
            context.client, table_id, key=key, source="formula", formula=formula
        )
    return table_id


async def _seed(
    context: AppContext, table_id: str, specs: list[tuple[str, int]]
) -> list[str]:
    """正常录入记录并返回稳定行键。Args: context, table_id, specs。"""
    ids = []
    for ts, reading in specs:
        saved = await create_record(
            context.client, table_id, ts=ts, values={"reading": reading}
        )
        ids.append(saved["record"]["row_id"])
    return ids


async def _record(context: AppContext, table_id: str, row_id: str, ts: str):
    item = await record_crud.get_one(
        context.session,
        table_id=UUID(table_id),
        row_id=UUID(row_id),
        ts=datetime.fromisoformat(ts),
    )
    assert item is not None
    return item


async def _stored_results(context: AppContext, table_id: str):
    response = await context.client.get(records_url(table_id))
    assert response.status_code == 200, response.text
    return {
        item["row_id"]: item["computed"] for item in data_of(response)["items"]
    }


def _row_calculations(values: Mapping[str, object]) -> dict[str, object]:
    """筛出能直接与单行求值对照的结果。Args: values。"""
    return {key: value for key, value in values.items() if key != "whole"}


async def test_same_time_reads_effective_inputs_and_batch_start_formula_cache(
    app_context: AppContext,
) -> None:
    table_id = await _table(app_context)
    first, lower_id, higher_id, following = await _seed(
        app_context, table_id, [(FIRST, 10), (TIED, 30), (TIED, 50), (LAST, 90)]
    )
    lower = await _record(app_context, table_id, lower_id, TIED)
    higher = await _record(app_context, table_id, higher_id, TIED)
    lower.computed_json = {"double": 301}
    higher.computed_json = {"double": 503}
    higher.overrides_json = {"reading": {"v": 55, "at": TIED}}
    await app_context.session.commit()
    columns = await column_crud.list_by_table(
        app_context.session, UUID(table_id)
    )
    scope = await record_compute.build_scope(
        app_context.session,
        columns=columns,
        timezone=ZoneInfo("Asia/Shanghai"),
    )
    singles = []
    for item in (lower, higher):
        computed, errors = await record_compute.compute_row(
            app_context.session,
            scope,
            RowTarget(
                table_id=UUID(table_id),
                ts=item.ts,
                exclude_row_id=item.row_id,
                current_values=effective_values(item),
            ),
        )
        assert not errors
        singles.append(computed)
    _, outcome = await run_recompute(app_context, table_id)
    assert (outcome["recomputed"], outcome["failed"]) == (4, 0)
    result = await _stored_results(app_context, table_id)
    for row_id, single in zip((lower_id, higher_id), singles, strict=True):
        assert _row_calculations(result[row_id]) == _row_calculations(single)
    assert result[lower_id]["formula_sum"] == 583
    assert result[higher_id]["formula_sum"] == 431
    assert result[following]["prior"] == 55
    assert result[following]["prior2"] == 30
    assert result[following]["formula_sum"] == 370
    assert result[lower_id]["complete"] is None
    assert result[first]["complete"] == 10


async def test_recompute_cut_inside_a_timestamp_keeps_all_other_peers(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    table_id = await _table(app_context)
    _, target, peer, later_peer, _ = await _seed(
        app_context,
        table_id,
        [(FIRST, 10), (TIED, 30), (TIED, 50), (TIED, 70), (LAST, 90)],
    )
    original = await _stored_results(app_context, table_id)
    monkeypatch.setattr(record_compute, "MAX_RECOMPUTE_ROWS", 2)
    _, outcome = await run_recompute(app_context, table_id)
    assert (outcome["recomputed"], outcome["is_truncated"]) == (2, True)
    result = await _stored_results(app_context, table_id)
    assert result[target]["sum"] == 160
    assert result[target]["count"] == 4
    assert result[target]["last"] == 30
    assert result[target]["prior"] == 10
    assert result[target]["complete"] is None
    assert result[peer] == original[peer]
    assert result[later_peer] == original[later_peer]
