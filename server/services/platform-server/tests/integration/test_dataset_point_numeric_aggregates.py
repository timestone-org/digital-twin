"""点位汇总列使用本地采集配置判定数值口径。"""

import httpx
import pytest

from integration.collect_helpers import create_points, create_source, point_item
from integration.dataset_helpers import (
    HTTP_BAD_REQUEST,
    HTTP_CREATED,
    column_body,
    columns_url,
    create_column,
    create_table,
    data_of,
)

pytestmark = pytest.mark.requires_postgres


@pytest.mark.parametrize(
    ("point_type", "agg", "expected"),
    [
        ("bool", "avg", HTTP_BAD_REQUEST),
        ("bool", "sum", HTTP_BAD_REQUEST),
        ("string", "avg", HTTP_BAD_REQUEST),
        ("string", "sum", HTTP_BAD_REQUEST),
        ("bool", "min", HTTP_CREATED),
        ("string", "max", HTTP_CREATED),
        ("string", "last", HTTP_CREATED),
        ("int", "sum", HTTP_CREATED),
        ("float", "avg", HTTP_CREATED),
    ],
)
async def test_point_aggregation_respects_the_configured_data_type(
    app_client: httpx.AsyncClient, point_type: str, agg: str, expected: int
) -> None:
    source = await create_source(
        app_client, endpoint="opc.tcp://127.0.0.1:4840", is_enabled=False
    )
    await create_points(
        app_client, source["id"], point_item("demo", data_type=point_type)
    )
    table = await create_table(app_client)
    response = await app_client.post(
        columns_url(table["id"]),
        json=column_body(
            source="point", node_key=f"{source['id']}:demo", agg=agg
        ),
    )
    assert response.status_code == expected, response.text
    if expected == HTTP_BAD_REQUEST:
        assert response.json()["details"][0]["field"] == "agg"


async def test_late_point_registration_keeps_old_columns_editable(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(
        app_client, endpoint="opc.tcp://127.0.0.1:4840", is_enabled=False
    )
    table = await create_table(app_client)
    node_key = f"{source['id']}:later"
    old = await create_column(
        app_client, table["id"], source="point", node_key=node_key, agg="avg"
    )
    await create_points(
        app_client, source["id"], point_item("later", data_type="bool")
    )
    url = f"{columns_url(table['id'])}/{old['id']}"
    unchanged = await app_client.patch(
        url,
        json={
            "name": "保留历史取数",
            "source": "point",
            "node_key": node_key,
            "agg": "avg",
        },
    )
    assert unchanged.status_code == 200, unchanged.text
    assert data_of(unchanged)["name"] == "保留历史取数"
    rejected = await app_client.patch(url, json={"agg": "sum"})
    assert rejected.status_code == HTTP_BAD_REQUEST, rejected.text
    accepted = await app_client.patch(url, json={"agg": "last"})
    assert accepted.status_code == 200, accepted.text
    assert data_of(accepted)["agg"] == "last"


async def test_rebinding_an_average_keeps_the_old_point_when_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(
        app_client, endpoint="opc.tcp://127.0.0.1:4840", is_enabled=False
    )
    await create_points(
        app_client,
        source["id"],
        point_item("number", data_type="int"),
        point_item("boolean", data_type="bool"),
    )
    table = await create_table(app_client)
    node_key = f"{source['id']}:number"
    col = await create_column(
        app_client, table["id"], source="point", node_key=node_key, agg="avg"
    )
    listing = columns_url(table["id"])
    rejected = await app_client.patch(
        f"{listing}/{col['id']}",
        json={"node_key": f"{source['id']}:boolean"},
    )
    assert rejected.status_code == HTTP_BAD_REQUEST
    rows = (await app_client.get(listing)).json()["data"]
    assert rows[0]["node_key"] == node_key
