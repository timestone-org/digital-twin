"""三十个预处理与特征算子的真实执行值、列序、时间及来源契约。"""

import math

import pytest

from platform_server.apps.modeling.operators import Frame, registry
from unit.transform_execution_fakes import ExecutionCase, execution_cases

CASES = execution_cases()


def test_execution_matrix_covers_every_preprocess_and_feature_operator() -> (
    None
):
    expected = {
        spec.code
        for spec in registry.specs()
        if spec.category in {"preprocess", "feature"}
    }
    assert len(CASES) == len({case.code for case in CASES}) == 30
    assert {case.code for case in CASES} == expected


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.code)
def test_transform_executes_the_hand_calculated_projection(
    case: ExecutionCase,
) -> None:
    operator, config = registry.build(case.code, case.config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    output = operator.run(case.inputs)["frame"]
    assert isinstance(output, Frame)
    assert output.keys == case.expected.keys
    assert output.index == case.expected.index
    assert output.provenance == case.expected.provenance
    assert output.row_count == case.expected.row_count
    sign = -1.0 if case.code == "pca" and output.rows[0][0] > 0 else 1.0
    for actual, expected in zip(output.rows, case.expected.rows, strict=True):
        assert len(actual) == len(expected)
        for value, wanted in zip(actual, expected, strict=True):
            if isinstance(wanted, (float, int)):
                assert isinstance(value, (float, int))
                assert math.isfinite(value)
                assert value * sign == pytest.approx(wanted)
            else:
                assert value == wanted
    columns = operator.describe_columns(
        config, {port: frame.keys for port, frame in case.inputs.items()}
    )["frame"]
    assert columns is None or columns == output.keys
    assert any(block.zone == "step" for block in operator.report())
