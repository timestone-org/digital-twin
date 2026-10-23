"""全部算子的输出列、行形状及摘要必须能被结果页面一致消费。"""

import json

import pytest

from contract.test_modeling_report_coverage import cases
from platform_server.apps.modeling.operators import Frame, FrameColumn, registry
from platform_server.apps.modeling.services import preview, report_budget


@pytest.mark.parametrize("code", registry.codes())
def test_column_reports_count_the_full_result_frame(code: str) -> None:
    inputs, config = cases()[code]
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    outputs = operator.run(inputs)
    for block in operator.report():
        if block.kind != "columns":
            continue
        result = outputs[block.port]
        assert isinstance(result, Frame)
        payload = block.payload
        assert payload["kept"] == len(result.columns), (code, block.title)
        added = set(payload["added"])
        removed = set(payload["removed"])
        assert added <= set(result.keys), (code, block.title)
        assert removed.isdisjoint(result.keys), (code, block.title)
        source = next(
            value for value in inputs.values() if isinstance(value, Frame)
        )
        assert payload["added_total"] == len(
            set(result.keys) - set(source.keys)
        )
        assert payload["removed_total"] == len(
            set(source.keys) - set(result.keys)
        )
        assert len(result.columns) == len(source.columns) + len(added) - len(
            removed
        )


def test_wide_join_column_totals_survive_report_and_preview_budgets() -> None:
    source = Frame(
        columns=tuple(
            FrameColumn(key=f"c{seat}", name=f"c{seat}", dtype="number")
            for seat in range(65)
        ),
        rows=(tuple(float(seat) for seat in range(65)),),
        index=(0,),
    )
    operator, _ = registry.build("ledger_join", {})
    result = operator.run({"left": source, "right": source})["frame"]
    assert isinstance(result, Frame)
    summary, truncated = preview.fit_budget(preview.summarize(result))
    assert truncated
    assert summary["shape"] == {"rows": 1, "cols": 130}
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    payload = next(
        block["payload"]
        for block in report["blocks"]
        if block["kind"] == "columns"
    )
    assert payload["kept"] == 130
    assert payload["added_total"] == 65
    assert len(payload["added"]) == 60
    assert payload["removed_total"] == payload["dtype_before_total"] == 0
    assert report_budget.size_of(report) <= preview.REPORT_MAX_BYTES


def test_cast_report_counts_type_changes_beyond_the_display_limit() -> None:
    source = Frame(
        columns=tuple(
            FrameColumn(key=f"c{seat}", name=f"c{seat}", dtype="string")
            for seat in range(20)
        ),
        rows=(tuple("1" for _ in range(20)),),
    )
    operator, _ = registry.build(
        "cast_type", {"columns": list(source.keys), "to": "number"}
    )
    result = operator.run({"frame": source})["frame"]
    assert isinstance(result, Frame)
    assert {column.dtype for column in result.columns} == {"number"}
    payload = next(
        block.payload for block in operator.report() if block.kind == "columns"
    )
    assert payload["dtype_before_total"] == 20
    assert len(payload["dtype_before"]) == 12


@pytest.mark.parametrize("code", registry.codes())
def test_operator_results_match_declared_ports_and_json_contract(
    code: str,
) -> None:
    inputs, config = cases()[code]
    operator, parsed = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    outputs = operator.run(inputs)
    declared = operator.describe_columns(
        parsed,
        {
            port: value.keys
            for port, value in inputs.items()
            if isinstance(value, Frame)
        },
    )
    assert set(outputs) == {port.name for port in operator.OUTPUTS}
    for port, value in outputs.items():
        if isinstance(value, Frame):
            assert len(value.keys) == len(set(value.keys)), (code, port)
            assert all(len(row) == len(value.keys) for row in value.rows)
            assert value.index is None or len(value.index) == value.row_count
            if declared[port] is not None:
                assert declared[port] == value.keys, (code, port)
        summary, _ = preview.fit_budget(preview.summarize(value))
        assert preview.size_of(summary) <= preview.PREVIEW_MAX_BYTES
        assert (
            json.loads(json.dumps(summary, allow_nan=False))["kind"]
            != "unknown"
        )
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report_budget.size_of(report) <= preview.REPORT_MAX_BYTES
    assert json.loads(json.dumps(report, allow_nan=False))["blocks"]
