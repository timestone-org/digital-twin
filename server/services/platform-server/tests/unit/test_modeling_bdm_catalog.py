"""BDM 目录的字段映射、精确过滤和无密钥出参。"""

from collections.abc import Callable

import httpx
import pytest
from pydantic import ValidationError

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
        "table_type": None,
        "unit": None,
    }
    assert SECRET not in result.model_dump_json()


@pytest.mark.parametrize("kind", ["point", "raw", "formula"])
async def test_names_are_filtered_upstream_for_every_catalog(
    monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.params["name"] == "温度"
        assert request.url.params["page"] == "3"
        assert "keyword" not in request.url.params
        return success({"total": 0, "page": 3, "pageSize": 50, "items": []})

    replace_transport(monkeypatch, respond)
    query = BdmCatalogQuery.model_validate(
        {"kind": kind, "name": "温度", "page": 3}
    )
    result = await bdm_catalog.read_catalog(connection(), query)
    assert result.total == 0
    assert result.page == 3


def test_name_filter_has_upstream_character_limit() -> None:
    with pytest.raises(ValidationError):
        BdmCatalogQuery.model_validate({"name": "温" * 101})


async def test_empty_catalog_accepts_omitted_zero_total(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return success({"page": 1, "pageSize": 50, "items": []})

    replace_transport(monkeypatch, respond)
    result = await bdm_catalog.read_catalog(connection(), BdmCatalogQuery())
    assert result.total == 0
    assert result.items == []


async def test_populated_catalog_requires_total(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return success(
            {"page": 1, "pageSize": 50, "items": [{"pointId": "p1"}]}
        )

    replace_transport(monkeypatch, respond)
    with pytest.raises(BdmReadFailed, match="响应格式"):
        await bdm_catalog.read_catalog(connection(), BdmCatalogQuery())


@pytest.mark.parametrize("is_available", [True, False])
async def test_point_systems_preserve_upstream_capability(
    monkeypatch: pytest.MonkeyPatch, is_available: bool
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/bdm/training-data/points/systems"
        return success(
            {
                "items": ["空压系统", "空调系统"] if is_available else [],
                "systemFilterAvailable": is_available,
            }
        )

    replace_transport(monkeypatch, respond)
    result = await bdm_catalog.read_systems(connection())
    assert result.system_filter_available is is_available
    assert result.items == (["空压系统", "空调系统"] if is_available else [])
    assert SECRET not in result.model_dump_json()


async def test_disabled_systems_are_unavailable() -> None:
    with pytest.raises(BdmReadFailed, match="未启用"):
        await bdm_catalog.read_systems(None)


@pytest.mark.parametrize(
    "data",
    [{"items": []}, {"items": [12], "systemFilterAvailable": True}],
)
async def test_malformed_systems_are_rejected(
    monkeypatch: pytest.MonkeyPatch, data: dict[str, object]
) -> None:
    replace_transport(monkeypatch, lambda _request: success(data))
    with pytest.raises(BdmReadFailed, match="响应格式"):
        await bdm_catalog.read_systems(connection())


async def test_point_configuration_audit_is_explicit_and_preserves_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.params["includeUnqueryable"] == "true"
        return success(
            {
                "total": 1,
                "page": 1,
                "pageSize": 50,
                "items": [
                    {
                        "pointId": "p1",
                        "tableType": "Run",
                        "historyAvailable": False,
                    }
                ],
            }
        )

    replace_transport(monkeypatch, respond)
    result = await bdm_catalog.read_catalog(
        connection(), BdmCatalogQuery(include_unqueryable=True)
    )
    assert result.items[0].history_available is False
    assert result.items[0].table_type == "Run"


async def test_raw_name_and_system_filter_preserves_unit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert dict(request.url.params) == {
            "kind": "raw",
            "name": "功率",
            "system": "空压系统",
            "page": "1",
            "pageSize": "50",
        }
        return success(
            {
                "total": 1,
                "page": 1,
                "pageSize": 50,
                "items": [
                    {
                        "propertyId": "r1",
                        "nodeName": "1#空压机",
                        "propertyName": "功率",
                        "unit": "kW",
                    }
                ],
            }
        )

    replace_transport(monkeypatch, respond)
    result = await bdm_catalog.read_catalog(
        connection(),
        BdmCatalogQuery(kind="raw", name="功率", system="空压系统"),
    )
    assert result.items[0].unit == "kW"
    assert result.items[0].name == "1#空压机 · 功率"


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
        {"kind": "raw", "include_unqueryable": True},
        {"kind": "formula", "include_unqueryable": True},
    ],
)
async def test_unsupported_filters_are_not_silently_ignored(
    values: dict[str, object],
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
