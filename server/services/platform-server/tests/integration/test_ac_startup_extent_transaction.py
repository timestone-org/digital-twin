"""开机批次页与重建请求在平台事务之外读取 EMS 的可用时间范围。"""

import pytest
from conftest import AppContext
from sqlalchemy import select
from unit.source_fakes import FakeAcSource

from integration.hvac_external_observer import observe_read
from integration.test_ac_startup_window_api import (
    PREFIX,
    SOURCE_START,
    bound_room,
)
from platform_server.apps.hvac.models import AcUnit

pytestmark = pytest.mark.requires_postgres


@pytest.mark.parametrize("is_rebuilding", [False, True])
async def test_extent_reads_leave_the_database_available(
    app_context: AppContext,
    ac_source: FakeAcSource,
    monkeypatch: pytest.MonkeyPatch,
    is_rebuilding: bool,
) -> None:
    room = await bound_room(app_context.session, "范围相位")
    path = f"{PREFIX}/rooms/{room}/startup-batches"
    with observe_read(monkeypatch, ac_source, "fetch_all") as counts:
        response = (
            await app_context.client.post(path + ":rebuild", json={})
            if is_rebuilding
            else await app_context.client.get(path)
        )
    assert response.status_code == (
        202 if is_rebuilding else 200
    ), response.text
    value = response.json()["data"]
    assert (
        value["window_start"]
        if is_rebuilding
        else value["source_range"]["start"]
    ) == SOURCE_START
    assert counts == [0]


async def test_changed_sources_cannot_queue_a_rebuild_for_the_previous_range(
    app_context: AppContext,
    ac_source: FakeAcSource,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await bound_room(app_context.session, "在途换源")
    unit = await app_context.session.scalar(
        select(AcUnit.id).where(AcUnit.room_id == room)
    )
    path = f"{PREFIX}/rooms/{room}/startup-batches"

    async def rebind() -> None:
        saved = await app_context.client.put(
            f"{PREFIX}/ac-units/{unit}/data-bindings/raw_minute",
            json={"source_object": "KTStartData_K02"},
        )
        assert saved.status_code == 200, saved.text

    with observe_read(monkeypatch, ac_source, "fetch_all", rebind):
        reply = await app_context.client.post(path + ":rebuild", json={})
    assert reply.status_code == 409, reply.text
    listed = await app_context.client.get(path)
    assert listed.json()["data"]["items"] == []
