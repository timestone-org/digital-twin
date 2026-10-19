"""前端半小时负荷图必须实际训练、发布并按目标时刻预测未来 12 点。"""

import json
import math
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest
from unit.modeling_fakes import DirectRunner, execution_of

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
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
    / "web/app/tests/pages/Modeling/fixtures/shortTermLoadGraph.json"
)
STEP_MS = 1_800_000
START = int(datetime(2026, 7, 1, 16, tzinfo=UTC).timestamp() * 1000)
KEYS = ("计划产量", "工单数", "预报温度", "负荷")
ENTRY = (
    "计划产量",
    "工单数",
    "预报温度",
    "六小时前_负荷",
    "昨日_负荷",
    "上周_负荷",
)
ROWS = 60 * 48


def template() -> PipelineGraph:
    graph = PipelineGraph.model_validate(json.loads(FIXTURE.read_text()))
    graph.node_by_id()["s"].config["table_code"] = "historical_load"
    return graph


def samples() -> Frame:
    rows = []
    for seat in range(ROWS):
        quantity = float(seat * 17 % 70)
        orders = float(seat * 3 % 5)
        temperature = 22.0 + (seat * 7 % 13)
        load = (
            100
            + quantity * 2
            + orders * 5
            + temperature * 3
            + 30 * math.sin(math.tau * (seat % 48) / 48)
        )
        rows.append((quantity, orders, temperature, load))
    return Frame(
        columns=tuple(
            FrameColumn(
                key=key,
                name=key,
                dtype="number",
                unit="kW" if key == "负荷" else "",
            )
            for key in KEYS
        ),
        rows=tuple(rows),
        index=tuple(START + seat * STEP_MS for seat in range(ROWS)),
        provenance=Provenance(
            table_codes=("historical_load",),
            since=datetime.fromtimestamp(START / 1000, UTC),
            until=datetime.fromtimestamp((START + ROWS * STEP_MS) / 1000, UTC),
        ),
    )


def test_half_hour_graph_and_forecast_time_budget_are_explicit() -> None:
    graph = template()
    assert check_graph(graph) == []
    nodes = graph.node_by_id()
    assert nodes["a"].config["bucket"] == "30m"
    assert nodes["p"].config["method"] == "time_order"
    offsets = [
        node.config["offset_minutes"]
        for node in graph.nodes
        if node.operator == "time_shift"
    ]
    assert offsets == [360, 1440, 10080]
    for target_minutes in range(0, 360, 30):
        assert target_minutes - min(offsets) + 30 <= 0


async def test_publish_and_predict_twelve_half_hours_match_scored_values() -> (
    None
):
    graph = template()
    outcome = await execute_graph(
        graph, execution=execution_of(DirectRunner(), frames={"s": samples()})
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
    assert tuple(column.key for column in verdict.entry_columns) == ENTRY
    assert verdict.signature["requires_timestamp"] is True
    assert verdict.signature["output"]["unit"] == "kW"
    compiled = compile_model(verdict.serving)
    cleaned = next(
        item.frames["frame"] for item in outcome.nodes if item.node_id == "d"
    )
    assert cleaned.row_count == ROWS - 336
    scored = next(
        item.frames["scored"] for item in outcome.nodes if item.node_id == "m"
    )
    assert scored.index is not None
    last = cleaned.rows[-12:]
    positions = [cleaned.position_of(key) for key in ENTRY]
    requests = [
        (
            [float(row[position]) for position in positions],
            datetime.fromtimestamp(moment / 1000, UTC),
        )
        for row, moment in zip(last, scored.index[-12:], strict=True)
    ]
    answers = compiled.predict_many(requests)
    assert answers == pytest.approx([row[1] for row in scored.rows[-12:]])
    assert answers == pytest.approx(
        [compiled.predict(args, at) for args, at in requests]
    )
    with pytest.raises(OperatorError, match="时刻"):
        compiled.predict(requests[0][0])
    assert compiled.predict([None, *requests[0][0][1:]], requests[0][1]) is None


async def test_gaps_and_missing_targets_do_not_become_fake_load_labels() -> (
    None
):
    original = samples()
    assert original.index is not None
    missing = 400
    rows = list(original.rows)
    rows[500] = (*rows[500][:3], None)
    source = replace(
        original,
        rows=tuple(rows[:missing] + rows[missing + 1 :]),
        index=original.index[:missing] + original.index[missing + 1 :],
    )
    outcome = await execute_graph(
        template(), execution=execution_of(DirectRunner(), frames={"s": source})
    )
    assert outcome.status == "succeeded", outcome.error_text
    joined = next(
        item.frames["frame"] for item in outcome.nodes if item.node_id == "j6"
    )
    assert joined.index is not None
    missing_history = joined.index.index(START + (missing + 12) * STEP_MS)
    assert (
        joined.rows[missing_history][joined.position_of("六小时前_负荷")]
        is None
    )
    cleaned = next(
        item.frames["frame"] for item in outcome.nodes if item.node_id == "d"
    )
    assert cleaned.index is not None
    for removed in (400, 412, 448, 500, 512, 548, 736, 836):
        assert START + removed * STEP_MS not in cleaned.index
