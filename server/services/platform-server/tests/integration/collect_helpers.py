"""采集面集成用例的共用件：建源、建点、读信封。"""

from typing import Any

import httpx

SOURCES = "/api/v1/platform/collect-sources"
POINTS = "/api/v1/platform/collect-points"
HISTORIES = "/api/v1/platform/point-histories"
PLAN = "/internal/v1/platform/collect-plan"


def envelope(response: httpx.Response) -> dict[str, Any]:
    """取响应信封。

    Args: response。
    """
    body: dict[str, Any] = response.json()
    return body


def payload(response: httpx.Response) -> dict[str, Any]:
    """取信封里的 `data` 段。

    Args: response。
    """
    data: dict[str, Any] = envelope(response)["data"]
    return data


def source_body(**overrides: Any) -> dict[str, Any]:
    """一个形状齐备的数据源请求体。

    Args: overrides。
    """
    body: dict[str, Any] = {
        "name": "一号线 PLC",
        "code": "line-1",
        "protocol": "opcua",
        "endpoint": "opc.tcp://10.0.0.9:4840",
        "read_mode": "subscribe",
        "poll_interval_ms": 1000,
        "is_enabled": True,
    }
    body.update(overrides)
    return body


def point_item(code: str = "outlet_temp", **overrides: Any) -> dict[str, Any]:
    """一个形状齐备的点位项。

    Args: code, overrides。
    """
    item: dict[str, Any] = {
        "code": code,
        "name": "出口温度",
        "address": f"ns=2;s={code}",
        "data_type": "float",
        "unit": "℃",
        "sampling_interval_ms": 1000,
    }
    item.update(overrides)
    return item


async def create_source(
    client: httpx.AsyncClient, **overrides: Any
) -> dict[str, Any]:
    """建一个数据源并回它的对外形态。

    Args: client, overrides。
    """
    response = await client.post(SOURCES, json=source_body(**overrides))
    assert response.status_code == 201, response.text
    return payload(response)


async def create_points(
    client: httpx.AsyncClient, source_id: str, *items: dict[str, Any]
) -> dict[str, Any]:
    """给一个数据源批量建点。

    Args: client, source_id, items。
    """
    response = await client.post(
        POINTS,
        json={"source_id": source_id, "items": list(items) or [point_item()]},
    )
    assert response.status_code == 201, response.text
    return payload(response)
