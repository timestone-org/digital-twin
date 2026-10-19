"""前端每日能耗模板必须通过真实图校验、执行、发布判定并预测新计划。"""

import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest
from unit.modeling_fakes import DirectRunner, execution_of

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    Provenance,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.graph_check import check_graph
from platform_server.apps.modeling.services.publish_service import inspect_run
from platform_server.apps.modeling.services.run_executor import execute_graph
from platform_server.apps.modeling.services.serving import compile_model

FIXTURE = (
    Path(__file__).resolve().parents[5]
    / "web/app/tests/pages/Modeling/fixtures/dailyEnergyGraphs.json"
)
DAY = 86_400_000
HOUR = 3_600_000
START = 16 * HOUR
NAMES = ("daily_energy", "daily_energy_joined")


def template(name: str) -> PipelineGraph:
    graph = PipelineGraph.model_validate(json.loads(FIXTURE.read_text())[name])
    for node in graph.nodes:
        if node.operator == "ledger_source":
            node.config["table_code"] = "historical_daily_data"
    return graph


def historical_frame() -> Frame:
    rows: list[tuple[float | None, ...]] = []
    for day in range(60):
        quantity = 0.0 if day == 10 else 80.0 + (day % 17) * 5
        orders = 0.0 if day == 10 else float(2 + day % 5)
        energy = 5.0 + 2 * quantity + 3 * orders
        rows.extend([(quantity / 2, orders / 2, energy / 2, energy)] * 2)
    rows[4] = (*rows[4][:2], None, rows[4][3])
    return Frame(
        columns=tuple(
            FrameColumn(
                key=key,
                name=key,
                dtype="number",
                unit="kWh" if key == "能耗" else "",
            )
            for key in ("计划产量", "工单数", "能耗", "不能用于预测的事后读数")
        ),
        rows=tuple(rows),
        index=tuple(
            START + day * DAY + hour * HOUR
            for day in range(60)
            for hour in (0, 12)
        ),
        provenance=Provenance(
            table_codes=("historical_daily_data",),
            since=datetime.fromtimestamp(START / 1000, UTC),
            until=datetime.fromtimestamp((START + 60 * DAY) / 1000, UTC),
        ),
    )


@pytest.mark.parametrize("name", NAMES)
def test_template_with_selected_tables_passes_graph_validation(
    name: str,
) -> None:
    assert check_graph(template(name)) == []


@pytest.mark.parametrize("name", NAMES)
async def test_daily_training_publishes_a_model_that_predicts_new_plans(
    name: str,
) -> None:
    graph = template(name)
    source = historical_frame()
    outcome = await execute_graph(
        graph,
        execution=execution_of(
            DirectRunner(), frames={"s": source, "se": source}
        ),
    )
    assert outcome.status == "succeeded", outcome.error_text
    records = {
        item.node_id: NodeRecord(
            preview=item.preview, fitted=item.fitted, io=item.io
        )
        for item in outcome.nodes
    }
    verdict = inspect_run(graph, records)
    assert verdict.is_servable, verdict.reason
    assert [column.key for column in verdict.entry_columns] == [
        "计划产量",
        "工单数",
    ]
    assert verdict.signature["output"]["unit"] == "kWh"
    assert compile_model(verdict.serving).predict(
        [230.0, 5.0]
    ) == pytest.approx(480.0)
    assert compile_model(verdict.serving).predict([0.0, 0.0]) == pytest.approx(
        5.0
    )
    cleaned = next(
        item.frames["frame"] for item in outcome.nodes if item.node_id == "d"
    )
    assert cleaned.row_count == 59
    assert records["f"].fitted is not None
    assert verdict.target_key not in records["f"].fitted


async def test_separate_sources_never_pair_different_business_days() -> None:
    graph = template("daily_energy_joined")
    source = historical_frame()
    energy = replace(
        source,
        rows=source.rows[2:],
        index=source.index[2:] if source.index else None,
    )
    outcome = await execute_graph(
        graph,
        execution=execution_of(
            DirectRunner(), frames={"s": source, "se": energy}
        ),
    )
    assert outcome.status == "succeeded", outcome.error_text
    joined = next(
        item.frames["frame"] for item in outcome.nodes if item.node_id == "j"
    )
    assert joined.index is not None
    assert joined.index[0] == START + DAY
    assert joined.row_count == 59
