"""远端 OPC UA 节点验型不占平台事务，写回时使用当前模型组合。"""

import uuid

import pytest
from conftest import AppContext, SignHeaders
from unit.opcua_fakes import FakeNodeWriter

from integration.hvac_external_observer import observe_read
from integration.test_ac_publication_api import (
    INSTANCE,
    _body,
    _path,
    _seeded_model,
)
from platform_server.apps.hvac.catalog import AC_MANAGE

pytestmark = pytest.mark.requires_postgres


@pytest.mark.parametrize("is_changing_sets", [False, True])
async def test_node_checks_release_the_transaction_and_revalidate_sets(
    app_context: AppContext,
    sign: SignHeaders,
    node_writer: FakeNodeWriter,
    monkeypatch: pytest.MonkeyPatch,
    is_changing_sets: bool,
) -> None:
    client = app_context.client
    model, keys = await _seeded_model(client, app_context.session, sign)
    requested = next(key for key in keys if "+" in key)
    remaining = next(key for key in keys if "+" not in key)
    node = uuid.uuid4()
    node_writer.add(INSTANCE, node, data_type="double")

    async def change_sets() -> None:
        result = await client.patch(
            f"/api/v1/platform/ac-models/{model['id']}",
            headers=sign([AC_MANAGE]),
            json={"serving_sets": [[remaining]]},
        )
        assert result.status_code == 200, result.text

    with observe_read(
        monkeypatch,
        node_writer,
        "resolve",
        change_sets if is_changing_sets else None,
    ) as counts:
        response = await client.put(
            _path(model["id"]),
            headers=sign([AC_MANAGE]),
            json=_body(
                set_bindings=[{"set_key": requested, "node_id": str(node)}]
            ),
        )
    assert counts == [0]
    if is_changing_sets:
        assert response.status_code == 422, response.text
        assert (await client.get(_path(model["id"]))).status_code == 404
    else:
        assert response.status_code == 200, response.text
        assert (
            response.json()["data"]["set_bindings"][0]["set_key"] == requested
        )
