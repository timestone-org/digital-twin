"""能管能力与指标绑定读面，不把元数据误作可查询历史。"""

from collections.abc import Callable

import httpx
import pytest

from platform_server.apps.modeling.schemas.bdm_discovery import (
    BdmIndicatorQuery,
)
from platform_server.apps.modeling.services import bdm_catalog
from platform_server.apps.modeling.services.bdm_client import (
    BdmClient,
    BdmConnection,
    BdmReadFailed,
)
from unit.test_modeling_bdm import SECRET, connection, success


def install(
    monkeypatch: pytest.MonkeyPatch,
    respond: Callable[[httpx.Request], httpx.Response],
) -> None:
    def client(_connection: BdmConnection) -> BdmClient:
        return BdmClient(connection(), transport=httpx.MockTransport(respond))

    monkeypatch.setattr(bdm_catalog, "BdmClient", client)


def test_capabilities_are_local_configuration_not_credentials() -> None:
    enabled = bdm_catalog.capabilities(connection())
    assert enabled.is_configured
    assert enabled.timezone == "Asia/Shanghai"
    assert enabled.minute_intervals == [
        1,
        2,
        3,
        4,
        5,
        6,
        10,
        12,
        15,
        20,
        30,
        60,
    ]
    assert SECRET not in enabled.model_dump_json()
    assert "bdm.example.test" not in enabled.model_dump_json()
    disabled = bdm_catalog.capabilities(None)
    assert not disabled.is_configured
    assert disabled.timezone is None


async def test_only_unit_property_binding_can_be_imported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/indicators")
        assert dict(request.url.params) == {
            "code": "energy.intensity",
            "page": "2",
            "pageSize": "20",
        }
        return success(
            {
                "total": 21,
                "page": 2,
                "pageSize": 20,
                "items": [
                    {
                        "id": "indicator-1",
                        "code": "energy.intensity",
                        "name": "能耗强度",
                        "sources": [
                            {
                                "sourceType": "unitProperty",
                                "sourceId": "property-1",
                                "alias": "能耗",
                            },
                            {
                                "sourceType": "modelOutput",
                                "sourceId": "prediction",
                                "alias": "预测",
                            },
                            {"sourceType": "unitProperty"},
                        ],
                    }
                ],
            }
        )

    install(monkeypatch, respond)
    result = await bdm_catalog.read_indicators(
        connection(),
        BdmIndicatorQuery(code="energy.intensity", page=2, size=20),
    )
    assert result.total == 21
    sources = result.items[0].sources
    assert [source.is_selectable for source in sources] == [True, False, False]
    assert sources[0].source_id == "property-1"
    assert sources[0].alias == "能耗"
    assert sources[1].source_type == "modelOutput"
    assert sources[2].source_id is None


async def test_indicator_empty_page_allows_omitted_default_total(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install(
        monkeypatch, lambda _: success({"items": [], "page": 1, "pageSize": 50})
    )
    result = await bdm_catalog.read_indicators(
        connection(), BdmIndicatorQuery()
    )
    assert result.total == 0
    assert result.items == []


async def test_indicator_query_requires_server_connection() -> None:
    with pytest.raises(BdmReadFailed, match="未启用"):
        await bdm_catalog.read_indicators(None, BdmIndicatorQuery())


async def test_malformed_indicator_binding_is_not_silently_selectable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install(
        monkeypatch,
        lambda _: success(
            {
                "total": 1,
                "page": 1,
                "pageSize": 50,
                "items": [
                    {
                        "id": "i",
                        "code": "K",
                        "name": "指标",
                        "sources": [
                            {"sourceType": "unitProperty", "sourceId": 123}
                        ],
                    }
                ],
            }
        ),
    )
    with pytest.raises(BdmReadFailed, match="契约"):
        await bdm_catalog.read_indicators(connection(), BdmIndicatorQuery())
