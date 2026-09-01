"""建模面的端到端：搭图 → 校验 → 跑 → 逐节点看结果 → 删。

⚠ 造的数据是**严格线性**的 `能耗 = 2×温度 + 3×负荷 + 5`，于是「跑完没报错」
不等于「算对了」这件事能被真正断言：整条链路跑下来学出的系数必须逐位吻合。
"""

import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.dataset_helpers import create_column, create_table
from integration.modeling_helpers import (
    ENERGY,
    HTTP_ACCEPTED,
    HTTP_BAD_REQUEST,
    HTTP_CONFLICT,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    HTTP_OK,
    LOAD,
    OPERATORS,
    PIPELINES,
    RUNS,
    TEMPERATURE,
    code_of,
    create_pipeline,
    data_of,
    linear_graph,
    pipeline_body,
)
from lib.utils.ids import uuid7
from lib.utils.timeutils import utcnow
from platform_server.apps.dataset.models import DatasetRecord

pytestmark = pytest.mark.requires_postgres

PIPELINE_CODE_TAKEN = 41402
GRAPH_INVALID = 41403
PIPELINE_NOT_FOUND = 41401
RUN_NOT_FOUND = 41405
RUN_ALREADY_ACTIVE = 41406
RUN_NOT_CANCELLABLE = 41407
NODE_RUN_NOT_FOUND = 41408

SLOPE_TEMPERATURE = 2.0
SLOPE_LOAD = 3.0
INTERCEPT = 5.0
ROWS = 120
STEP_MS = 3_600_000
OPERATOR_COUNT = 6


async def _seed_ledger(
    client: httpx.AsyncClient, session: AsyncSession, code: str
) -> str:
    """建一张三列的台账并种进 120 行严格线性的数据。

    ⚠ 直接落行而不是走录入端点：这条用例要的是「有一段能训的数据」，
    逐行发 120 次 HTTP 会把用例时长变成主要成本。
    Args: client, session, code。
    """
    table = await create_table(client, code=code, name="能耗小时表")
    table_id = str(table["id"])
    for key in (TEMPERATURE, LOAD, ENERGY):
        await create_column(client, table_id, key=key, name=key)
    base = utcnow().replace(microsecond=0)
    for index in range(ROWS):
        temperature = 20.0 + (index % 13) * 0.7
        load = 400.0 + (index % 7) * 15.0
        session.add(
            DatasetRecord(
                table_id=uuid.UUID(table_id),
                ts=base.fromtimestamp(
                    base.timestamp() - (ROWS - index) * STEP_MS / 1000,
                    tz=base.tzinfo,
                ),
                row_id=uuid7(),
                values_json={
                    TEMPERATURE: temperature,
                    LOAD: load,
                    ENERGY: SLOPE_TEMPERATURE * temperature
                    + SLOPE_LOAD * load
                    + INTERCEPT,
                },
                source="collect",
            )
        )
    await session.commit()
    return table_id


async def _run_pipeline(
    client: httpx.AsyncClient, pipeline_id: str
) -> dict[str, Any]:
    """发起一次运行并回它的详情。

    Args: client, pipeline_id。
    """
    response = await client.post(
        f"{PIPELINES}/{pipeline_id}:run", json={"trigger": "manual"}
    )
    assert response.status_code == HTTP_ACCEPTED, response.text
    return dict(data_of(response))


async def test_the_operator_catalog_exposes_ports_and_schemas(
    app_client: httpx.AsyncClient,
) -> None:
    """算子目录一次给全端口与参数 schema——前端画布靠它，不许自己硬编码端口。"""
    response = await app_client.get(OPERATORS)
    assert response.status_code == HTTP_OK
    catalog = data_of(response)
    assert len(catalog) == OPERATOR_COUNT
    source = next(item for item in catalog if item["code"] == "ledger_source")
    assert [port["name"] for port in source["outputs"]] == ["frame"]
    assert source["config_schema"]["properties"]["table_code"]


async def test_a_pipeline_round_trips_through_the_api(
    app_client: httpx.AsyncClient,
) -> None:
    """建、读、改、列，图原样存原样回。"""
    created = await create_pipeline(app_client, "rt", linear_graph("any"))
    assert created["node_count"] == OPERATOR_COUNT
    assert created["source_table_codes"] == ["any"]

    detail = data_of(await app_client.get(f"{PIPELINES}/{created['id']}"))
    assert len(detail["graph"]["edges"]) == OPERATOR_COUNT

    patched = await app_client.patch(
        f"{PIPELINES}/{created['id']}", json={"name": "改过的名字"}
    )
    assert data_of(patched)["name"] == "改过的名字"

    listed = data_of(await app_client.get(PIPELINES, params={"q": "rt"}))
    assert [item["code"] for item in listed["items"]] == ["rt"]


async def test_a_duplicate_pipeline_code_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    """编码是身份，重复即 409。"""
    await create_pipeline(app_client, "dup")
    response = await app_client.post(PIPELINES, json=pipeline_body("dup"))
    assert response.status_code == HTTP_CONFLICT
    assert code_of(response) == PIPELINE_CODE_TAKEN


async def test_a_missing_pipeline_is_a_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    """取不到的流水线是 404，不是 500。"""
    response = await app_client.get(f"{PIPELINES}/{uuid7()}")
    assert response.status_code == HTTP_NOT_FOUND
    assert code_of(response) == PIPELINE_NOT_FOUND


async def test_validation_lists_every_problem_at_once(
    app_client: httpx.AsyncClient,
) -> None:
    """校验把问题一次列全，且报的是中文人话。"""
    graph = linear_graph("any")
    graph["nodes"][3]["config"] = {"target_column": "没有这一列"}
    created = await create_pipeline(app_client, "bad", graph)
    response = await app_client.post(f"{PIPELINES}/{created['id']}:validate")
    assert response.status_code == HTTP_OK
    result = data_of(response)
    assert result["is_valid"] is False
    assert "上游没有列「没有这一列」" in [
        issue["message"] for issue in result["issues"]
    ]


async def test_an_empty_pipeline_cannot_be_run(
    app_client: httpx.AsyncClient,
) -> None:
    """空图跑不起来，且逐条说明为什么。"""
    created = await create_pipeline(app_client, "empty")
    response = await app_client.post(
        f"{PIPELINES}/{created['id']}:run", json={"trigger": "manual"}
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert code_of(response) == GRAPH_INVALID
    assert response.json()["details"]


async def test_a_run_recovers_the_true_coefficients(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """整条链路跑下来，每个节点都有结果，且模型学出的系数逐位吻合。"""
    await _seed_ledger(app_client, db_session, "energy_ok")
    created = await create_pipeline(
        app_client, "ok", _without_standardize("energy_ok")
    )
    run = await _run_pipeline(app_client, created["id"])
    assert run["status"] == "succeeded"
    assert run["row_count"] == ROWS
    assert run["is_source_truncated"] is False
    assert [item["status"] for item in run["nodes"]] == ["succeeded"] * 5

    model = data_of(await app_client.get(f"{RUNS}/{run['id']}/nodes/m"))[
        "preview"
    ]["model"]
    coefficients = model["fitted"]["coef"]
    assert coefficients[TEMPERATURE] == pytest.approx(SLOPE_TEMPERATURE)
    assert coefficients[LOAD] == pytest.approx(SLOPE_LOAD)
    assert model["fitted"]["intercept"] == pytest.approx(INTERCEPT)


async def test_metrics_are_perfect_on_a_strictly_linear_ledger(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """严格线性的台账上 R² 恰为 1，评估节点的摘要按 `kind` 派发。"""
    await _seed_ledger(app_client, db_session, "energy_metrics")
    created = await create_pipeline(
        app_client, "metrics", linear_graph("energy_metrics")
    )
    run = await _run_pipeline(app_client, created["id"])
    assert run["status"] == "succeeded"
    preview = data_of(await app_client.get(f"{RUNS}/{run['id']}/nodes/e"))
    assert preview["preview"]["metrics"]["kind"] == "metrics"
    assert preview["preview"]["metrics"]["metrics"]["r2"] == pytest.approx(1.0)


async def test_the_run_list_and_detail_carry_the_frozen_graph(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """运行详情带的是**当时那份图**，改了流水线也不跟着变。"""
    await _seed_ledger(app_client, db_session, "energy_snap")
    created = await create_pipeline(
        app_client, "snap", linear_graph("energy_snap")
    )
    run = await _run_pipeline(app_client, created["id"])

    await app_client.patch(
        f"{PIPELINES}/{created['id']}",
        json={"graph": {"format_version": "1.0", "nodes": [], "edges": []}},
    )
    detail = data_of(await app_client.get(f"{RUNS}/{run['id']}"))
    assert len(detail["graph"]["nodes"]) == OPERATOR_COUNT

    listed = data_of(
        await app_client.get(RUNS, params={"pipeline_id": created["id"]})
    )
    assert [item["id"] for item in listed["items"]] == [run["id"]]


async def test_a_failed_run_stops_and_skips_the_rest(
    app_client: httpx.AsyncClient,
) -> None:
    """取数取不到台账时整条运行失败，后面的节点显式落 skipped。"""
    created = await create_pipeline(
        app_client, "fail", linear_graph("查无此表")
    )
    response = await app_client.post(
        f"{PIPELINES}/{created['id']}:run", json={"trigger": "manual"}
    )
    assert response.status_code == HTTP_ACCEPTED
    run = data_of(response)
    assert run["status"] == "failed"
    assert [item["status"] for item in run["nodes"]] == ["failed"] + [
        "skipped"
    ] * 5
    # ⚠ 这一条是承重的：取不到台账时若把 404 抛成 HTTP 错，请求事务会回滚，
    # 那次运行的记录整个消失——用户拿到一个 404，运行历史里什么都没有
    assert run["error_text"] == "台账不存在"


async def test_a_missing_node_result_is_a_not_found(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """取不到的节点结果是 404 + 明确原因，绝不静默返回空。"""
    await _seed_ledger(app_client, db_session, "energy_404")
    created = await create_pipeline(
        app_client, "n404", linear_graph("energy_404")
    )
    run = await _run_pipeline(app_client, created["id"])
    response = await app_client.get(f"{RUNS}/{run['id']}/nodes/没有这个节点")
    assert response.status_code == HTTP_NOT_FOUND
    assert code_of(response) == NODE_RUN_NOT_FOUND


async def test_a_finished_run_cannot_be_cancelled(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """已经是终态的运行取消不了。"""
    await _seed_ledger(app_client, db_session, "energy_cancel")
    created = await create_pipeline(
        app_client, "cancel", linear_graph("energy_cancel")
    )
    run = await _run_pipeline(app_client, created["id"])
    response = await app_client.post(f"{RUNS}/{run['id']}:cancel")
    assert response.status_code == HTTP_CONFLICT
    assert code_of(response) == RUN_NOT_CANCELLABLE


async def test_a_missing_run_is_a_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    """取不到的运行是 404。"""
    response = await app_client.get(f"{RUNS}/{uuid7()}")
    assert response.status_code == HTTP_NOT_FOUND
    assert code_of(response) == RUN_NOT_FOUND


async def test_a_pipeline_is_deleted_with_its_runs(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """删流水线，它的运行记录随之级联消失。"""
    await _seed_ledger(app_client, db_session, "energy_del")
    created = await create_pipeline(
        app_client, "del", linear_graph("energy_del")
    )
    run = await _run_pipeline(app_client, created["id"])
    response = await app_client.delete(f"{PIPELINES}/{created['id']}")
    assert response.status_code == HTTP_NO_CONTENT
    assert (
        await app_client.get(f"{RUNS}/{run['id']}")
    ).status_code == HTTP_NOT_FOUND


def _without_standardize(table_code: str) -> dict[str, Any]:
    """去掉标准化那一步，让系数留在原始尺度上便于逐位核对。

    Args: table_code。
    """
    graph = linear_graph(table_code)
    graph["nodes"] = [item for item in graph["nodes"] if item["id"] != "z"]
    graph["edges"] = [
        item for item in graph["edges"] if item["id"] not in {"e2", "e3"}
    ]
    graph["edges"].append(
        {
            "id": "relink",
            "from_node": "f",
            "from_port": "frame",
            "to_node": "p",
            "to_port": "frame",
        }
    )
    return graph
