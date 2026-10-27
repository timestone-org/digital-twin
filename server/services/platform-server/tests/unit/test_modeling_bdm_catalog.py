"""BDM 目录的字段映射、精确过滤和无密钥出参。"""

from collections.abc import Callable

import httpx
import pytest

from lib.errors import ValidationFailed
from platform_server.apps.modeling.schemas.bdm import BdmCatalogQuery
from platform_server.apps.modeling.services import bdm_catalog
from platform_server.apps.modeling.services.bdm_client import (
    BdmClient,
    BdmConnection,
    BdmReadFailed,
)
from unit.test_modeling_bdm import SECRET, connection, success


def replace_transport(
    monkeypatch: pytest.MonkeyPatch,
    respond: Callable[[httpx.Request], httpx.Response],
) -> None:
    def client(_connection: BdmConnection) -> BdmClient:
        return BdmClient(connection(), transport=httpx.MockTransport(respond))

    monkeypatch.setattr(bdm_catalog, "BdmClient", client)


async def test_point_catalog_filters_and_missing_system_are_preserved(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/bdm/training-data/points"
        assert request.url.params["keyword"] == "温度"
        assert request.url.params["code"] == "P_1"
        assert request.url.params["system"] == "空压"
        return success(
            {
                "total": 1,
                "page": 1,
                "pageSize": 50,
                "systemFilterAvailable": True,
                "items": [
                    {
                        "pointId": "p1",
                        "code": "P_1",
                        "name": "温度",
                        "historyAvailable": True,
                    }
                ],
            }
        )

    replace_transport(monkeypatch, respond)
    result = await bdm_catalog.read_catalog(
        connection(), BdmCatalogQuery(keyword="温度", code="P_1", system="空压")
    )
    assert result.system_filter_available is True
    assert result.items[0].model_dump() == {
        "identifier": "p1",
        "code": "P_1",
        "name": "温度",
        "system": None,
        "history_available": True,
    }
    assert SECRET not in result.model_dump_json()


@pytest.mark.parametrize(
    ("kind", "item", "expected"),
    [
        (
            "raw",
            {
                "propertyId": "r1",
                "nodeName": "空压机",
                "propertyName": "功率",
                "nodeSystem": "空压",
            },
            "空压机 · 功率",
        ),
        ("formula", {"code": "F_1", "name": "日用水"}, "日用水"),
    ],
)
async def test_property_and_formula_directories(
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    item: dict[str, object],
    expected: str,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.params["kind"] == kind
        return success({"total": 1, "page": 2, "pageSize": 50, "items": [item]})

    replace_transport(monkeypatch, respond)
    query = BdmCatalogQuery.model_validate({"kind": kind, "page": 2})
    result = await bdm_catalog.read_catalog(connection(), query)
    assert result.items[0].name == expected
    assert result.page == 2


@pytest.mark.parametrize(
    "values",
    [
        {"kind": "formula", "keyword": "x"},
        {"kind": "raw", "code": "x"},
        {"kind": "formula", "system": "x"},
    ],
)
async def test_unsupported_filters_are_not_silently_ignored(
    values: dict[str, str],
) -> None:
    with pytest.raises(ValidationFailed):
        await bdm_catalog.read_catalog(
            connection(), BdmCatalogQuery.model_validate(values)
        )


async def test_disabled_catalog_is_unavailable() -> None:
    with pytest.raises(BdmReadFailed, match="未启用"):
        await bdm_catalog.read_catalog(None, BdmCatalogQuery())


async def test_unavailable_system_filter_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return success(
            {
                "total": 0,
                "page": 1,
                "pageSize": 50,
                "systemFilterAvailable": False,
                "items": [],
            }
        )

    replace_transport(monkeypatch, respond)
    with pytest.raises(ValidationFailed, match="系统过滤"):
        await bdm_catalog.read_catalog(
            connection(), BdmCatalogQuery(system="空压")
        )


@pytest.mark.parametrize(
    "item",
    [
        {"code": "P_1"},
        {"pointId": 12},
        {"pointId": "p1", "historyAvailable": "yes"},
    ],
)
async def test_malformed_catalog_is_not_an_empty_list(
    monkeypatch: pytest.MonkeyPatch, item: dict[str, object]
) -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return success({"total": 1, "page": 1, "pageSize": 50, "items": [item]})

    replace_transport(monkeypatch, respond)
    with pytest.raises(BdmReadFailed):
        await bdm_catalog.read_catalog(connection(), BdmCatalogQuery())
