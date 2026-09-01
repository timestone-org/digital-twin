"""建模面用例共用的 URL、请求体与建资源的捷径。"""

from typing import Any

import httpx

PIPELINES = "/api/v1/platform/modeling-pipelines"
RUNS = "/api/v1/platform/modeling-runs"
OPERATORS = "/api/v1/platform/modeling-operators"

HTTP_OK = 200
HTTP_CREATED = 201
HTTP_ACCEPTED = 202
HTTP_NO_CONTENT = 204
HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409

# 造数用的三列：能耗 = 2×温度 + 3×负荷 + 5
TEMPERATURE = "温度"
LOAD = "负荷"
ENERGY = "能耗"


def data_of(response: httpx.Response) -> Any:
    """取信封里的 data。"""
    return response.json()["data"]


def code_of(response: httpx.Response) -> int:
    """取信封里的错误码。"""
    return int(response.json()["code"])


def node(node_id: str, operator: str, **config: object) -> dict[str, Any]:
    """造一个节点。

    Args: node_id, operator, config。
    """
    return {
        "id": node_id,
        "operator": operator,
        "alias": "",
        "config": dict(config),
        "position": {"left": 0.0, "top": 0.0},
    }


def edge(
    edge_id: str, source: str, out_port: str, target: str, in_port: str
) -> dict[str, Any]:
    """造一条带端口的边。

    Args: edge_id, source, out_port, target, in_port。
    """
    return {
        "id": edge_id,
        "from_node": source,
        "from_port": out_port,
        "to_node": target,
        "to_port": in_port,
    }


def linear_graph(table_code: str) -> dict[str, Any]:
    """五类算子各一个的最小闭环。

    Args: table_code。
    """
    return {
        "format_version": "1.0",
        "nodes": [
            node(
                "s",
                "ledger_source",
                table_code=table_code,
                columns=[TEMPERATURE, LOAD, ENERGY],
                since="",
                until="",
            ),
            node("f", "fill_missing"),
            node("z", "standardize"),
            node("p", "split_dataset", target_column=ENERGY),
            node("m", "linear_regression"),
            node("e", "regression_metrics"),
        ],
        "edges": [
            edge("e1", "s", "frame", "f", "frame"),
            edge("e2", "f", "frame", "z", "frame"),
            edge("e3", "z", "frame", "p", "frame"),
            edge("e4", "p", "train", "m", "train"),
            edge("e5", "p", "test", "m", "test"),
            edge("e6", "m", "scored", "e", "scored"),
        ],
    }


def pipeline_body(
    code: str, graph: dict[str, Any] | None = None
) -> dict[str, Any]:
    """建流水线的请求体。

    Args: code, graph。
    """
    body: dict[str, Any] = {"code": code, "name": f"流水线 {code}"}
    if graph is not None:
        body["graph"] = graph
    return body


async def create_pipeline(
    client: httpx.AsyncClient, code: str, graph: dict[str, Any] | None = None
) -> dict[str, Any]:
    """建一条流水线并回它的详情。

    Args: client, code, graph。
    """
    response = await client.post(PIPELINES, json=pipeline_body(code, graph))
    assert response.status_code == HTTP_CREATED, response.text
    return dict(data_of(response))
