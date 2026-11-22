"""EMS 历史、面板读数与数据源绑定在等待外部读取时不占业务事务。"""

from uuid import uuid4

import pytest
from conftest import AppContext
from unit.source_fakes import FakeAcSource

from integration.hvac_external_observer import observe_read
from integration.test_ac_live_readings_api import (
    add_unit,
    read_units,
    seed_room,
)
from integration.test_ac_reading_api import WINDOW, bound_unit

pytestmark = pytest.mark.requires_postgres
PREFIX = "/api/v1/platform"


async def test_live_panel_reads_ems_after_releasing_its_transaction(
    app_context: AppContext,
    ac_source: FakeAcSource,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await seed_room(app_context.client, "实时读事务")
    await add_unit(app_context.client, room, serial="QA-" + uuid4().hex[:8])
    with observe_read(monkeypatch, ac_source, "fetch_all") as counts:
        units = await read_units(app_context.client, room)
    assert len(units) == 1
    assert counts == [0]


@pytest.mark.parametrize("resource", ["raw-samples", "raw-series"])
async def test_history_releases_the_binding_before_reading_ems(
    app_context: AppContext,
    ac_source: FakeAcSource,
    monkeypatch: pytest.MonkeyPatch,
    resource: str,
) -> None:
    unit = await bound_unit(app_context.client, "历史读事务")
    path = f"{PREFIX}/ac-units/{unit}/{resource}?{WINDOW}"
    if resource == "raw-series":
        path += "&metrics=workshop_temp_avg&bucket_minutes=5"
    with observe_read(monkeypatch, ac_source, "fetch_all") as counts:
        response = await app_context.client.get(path)
    assert response.status_code == 200, response.text
    assert counts == [0]


async def test_binding_checks_ems_before_opening_the_write_transaction(
    app_context: AppContext,
    ac_source: FakeAcSource,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await seed_room(app_context.client, "绑定读事务")
    unit = await add_unit(
        app_context.client,
        room,
        serial="QA-" + uuid4().hex[:8],
        source_object=None,
    )
    with observe_read(monkeypatch, ac_source, "describe_columns") as counts:
        response = await app_context.client.put(
            f"{PREFIX}/ac-units/{unit}/data-bindings/raw_minute",
            json={"source_object": "KTStartData_K01"},
        )
    assert response.status_code == 200, response.text
    assert counts == [0]


async def test_binding_rechecks_a_removed_unit_after_the_external_read(
    app_context: AppContext,
    ac_source: FakeAcSource,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await seed_room(app_context.client, "绑定删除")
    unit = await add_unit(
        app_context.client,
        room,
        serial="QA-" + uuid4().hex[:8],
        source_object=None,
    )

    async def remove_unit() -> None:
        result = await app_context.client.delete(f"{PREFIX}/ac-units/{unit}")
        assert result.status_code == 204, result.text

    with observe_read(
        monkeypatch, ac_source, "describe_columns", remove_unit
    ) as counts:
        response = await app_context.client.put(
            f"{PREFIX}/ac-units/{unit}/data-bindings/raw_minute",
            json={"source_object": "KTStartData_K01"},
        )
    assert counts == [0]
    assert response.status_code == 404, response.text
