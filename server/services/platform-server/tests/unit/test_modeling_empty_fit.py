"""合法的空拟合参数：一列都不编的独热、全是常量列而跳过的标准化。

⚠ 用「参数字典空不空」判「回灌过没有」的话，这两种步骤永远发布不了（重跑出来
的还是空），放行了又会在推理时拿请求那一批重新拟合。
"""

import pytest

from platform_server.apps.modeling.operators import Frame, FrameColumn, registry
from platform_server.apps.modeling.services.serving import compile_model
from unit.test_modeling_tabular_serving import published


def _frame() -> Frame:
    """两行一列数值。"""
    return Frame(
        columns=(FrameColumn(key="温度", name="温度", dtype="number"),),
        rows=((10.0,), (30.0,)),
    )


def test_a_loaded_empty_standardize_does_not_refit() -> None:
    operator, _ = registry.build("standardize", {"on_constant_column": "skip"})
    operator.load_fitted({})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    produced = operator.run({"frame": _frame()})["frame"]
    assert isinstance(produced, Frame)
    assert produced.values_of("温度") == [10.0, 30.0]


async def test_a_default_one_hot_step_is_publishable() -> None:
    verdict = await published("one_hot", {})
    assert verdict.is_servable, verdict.reason
    assert compile_model(verdict.serving).predict([25.0, 430.0]) == (
        pytest.approx(1345.0)
    )
