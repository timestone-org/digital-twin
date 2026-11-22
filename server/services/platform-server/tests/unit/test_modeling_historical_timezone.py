"""真实节点在夏令时历史窗口内的桶与时间特征。"""

from dataclasses import replace
from datetime import datetime
from typing import Any

import pytest

from platform_server.apps.modeling.operators import Frame, FrameColumn
from platform_server.apps.modeling.operators.frame import DataPeriod, Provenance
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.node_task import (
    NodePayload,
    NodeResult,
    run_node_payload,
)
from platform_server.apps.modeling.services.publish_service import inspect_run
from platform_server.apps.modeling.services.run_executor import execute_graph
from platform_server.apps.modeling.services.serving import compile_model
from unit.modeling_fakes import DirectRunner, edge, execution_of, node

ZONE = "America/New_York"
SPRING = (
    ("2026-03-08T04:30+00:00", 2.0),
    ("2026-03-08T05:30+00:00", 10.0),
    ("2026-03-08T07:30+00:00", 30.0),
    ("2026-03-09T04:30+00:00", 100.0),
)
AUTUMN = (
    ("2026-11-01T04:30+00:00", 5.0),
    ("2026-11-01T05:30+00:00", 10.0),
    ("2026-11-01T06:30+00:00", 20.0),
    ("2026-11-01T07:30+00:00", 30.0),
)


def _ms(value: str) -> int:
    return int(datetime.fromisoformat(value).timestamp() * 1000)


def _frame(samples: tuple[tuple[str, float], ...]) -> Frame:
    return Frame(
        columns=(FrameColumn(key="x", name="用量", dtype="number"),),
        rows=tuple((value,) for _, value in samples),
        index=tuple(_ms(time) for time, _ in samples),
    )


def _run(
    operator: str,
    frame: Frame,
    config: dict[str, Any],
    zone: str | None = ZONE,
) -> NodeResult:
    return run_node_payload(
        NodePayload(
            operator=operator,
            config=config,
            inputs={"frame": frame},
            tz_offset_minutes=0,
            split_plan=None,
            business_timezone=zone,
        )
    )


@pytest.mark.parametrize(
    ("samples", "since", "until", "expected"),
    [
        (SPRING, "2026-03-08T05:00+00:00", "2026-03-09T04:00+00:00", 40.0),
        (AUTUMN, "2026-11-01T04:00+00:00", "2026-11-02T05:00+00:00", 65.0),
    ],
    ids=["23-hour-day", "25-hour-day"],
)
def test_complete_days_use_their_actual_historical_bounds(
    samples: tuple[tuple[str, float], ...],
    since: str,
    until: str,
    expected: float,
) -> None:
    base = _frame(samples)
    frame = Frame(
        columns=base.columns,
        rows=base.rows,
        index=base.index,
        provenance=Provenance(
            since=datetime.fromisoformat(since),
            until=datetime.fromisoformat(until),
        ),
    )
    out = _run(
        "resample",
        frame,
        {"bucket": "1d", "agg": "sum", "should_keep_complete_buckets": True},
    ).outputs["frame"]
    assert out.index == (_ms(since),)
    assert out.rows == ((expected,),)
    assert out.provenance.data_period == DataPeriod(
        kind="calendar", calendar_unit="day", timezone=ZONE
    )


def test_repeated_autumn_hours_are_separate_real_time_buckets() -> None:
    out = _run(
        "resample", _frame(AUTUMN), {"bucket": "1h", "agg": "sum"}
    ).outputs["frame"]
    assert out.index == tuple(
        _ms(f"2026-11-01T{hour:02d}:00+00:00") for hour in range(4, 8)
    )
    assert out.rows == ((5.0,), (10.0,), (20.0,), (30.0,))


def test_utc_buckets_keep_their_previous_rows_and_period() -> None:
    args = ("resample", _frame(SPRING), {"bucket": "1d", "agg": "sum"})
    named = _run(*args, zone="UTC")
    legacy = _run(*args, zone=None)
    assert named.outputs == legacy.outputs
    assert named.report == legacy.report


def test_time_feature_freezes_the_zone_and_uses_each_historical_hour() -> None:
    result = _run("time_feature", _frame(SPRING), {"parts": ["hour"]})
    assert result.fitted == {"timezone": ZONE}
    assert result.outputs["frame"].values_of("ts_hour") == [23.0, 0.0, 3.0, 0.0]


def _training_graph() -> PipelineGraph:
    return PipelineGraph(
        nodes=[
            node("source", "ledger_source", table_code="energy"),
            node("timezone", "time_feature", parts=["hour"]),
            node("split", "split_dataset", target_column="energy"),
            node("regress", "linear_regression"),
        ],
        edges=[
            edge("e1", "source", "frame", "timezone", "frame"),
            edge("e2", "timezone", "frame", "split", "frame"),
            edge("e3", "split", "train", "regress", "train"),
            edge("e4", "split", "test", "regress", "test"),
        ],
    )


async def test_training_and_publication_replay_the_same_named_timezone() -> (
    None
):
    input_frame = _frame(SPRING + AUTUMN)
    hours = (23, 0, 3, 0, 0, 1, 1, 2)
    frame = replace(
        input_frame,
        columns=(*input_frame.columns, FrameColumn("energy", "能耗", "number")),
        rows=tuple(
            (value, 2 * value + hour)
            for (_, value), hour in zip(SPRING + AUTUMN, hours, strict=True)
        ),
    )
    graph = _training_graph()
    execution = replace(
        execution_of(DirectRunner(), frames={"source": frame}),
        business_timezone=ZONE,
    )
    outcome = await execute_graph(graph, execution=execution)
    assert outcome.status == "succeeded"
    verdict = inspect_run(
        graph,
        {
            result.node_id: NodeRecord(
                preview=dict(result.preview),
                fitted=result.fitted,
                io=dict(result.io),
            )
            for result in outcome.nodes
        },
    )
    assert verdict.is_servable, verdict.reason
    assert verdict.serving["format_version"] == "2.2"
    model = compile_model(verdict.serving)
    moments = [datetime.fromisoformat(date) for date, _ in SPRING + AUTUMN]
    assert model.predict_many(
        [
            ([value], moment)
            for (_, value), moment in zip(SPRING + AUTUMN, moments, strict=True)
        ]
    ) == pytest.approx([row[1] for row in frame.rows])


def test_a_24_hour_window_does_not_cover_the_entire_autumn_day() -> None:
    frame = replace(
        _frame(AUTUMN),
        provenance=Provenance(
            since=datetime.fromisoformat("2026-11-01T04:00+00:00"),
            until=datetime.fromisoformat("2026-11-02T04:00+00:00"),
        ),
    )
    out = _run(
        "resample",
        frame,
        {"bucket": "1d", "should_keep_complete_buckets": True},
    ).outputs["frame"]
    assert out.rows == ()
