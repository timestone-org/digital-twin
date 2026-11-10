"""运行级摘要预算用光之后，模型与评估摘要仍原样保留。

⚠ 发布读的是模型摘要里的通道、目标列与特征列：它们被换成桩之后，这一次运行
训练得好好的却发布不了，拒绝理由还指向算法。
"""

import pytest

from platform_server.apps.modeling.services import preview, run_executor

MODEL = {
    "kind": preview.KIND_MODEL,
    "algo": "linear_regression",
    "task": "regression",
    "hyper_params": {},
    "feature_keys": ["温度"],
    "target_key": "能耗",
    "serving_channel": "params",
    "fitted": {"intercept": 1.0},
}
METRICS = {
    "kind": preview.KIND_METRICS,
    "task": "regression",
    "metrics": {"r2": 0.9},
}


@pytest.mark.parametrize(
    ("port", "summary"), [("model", MODEL), ("metrics", METRICS)]
)
def test_model_and_metrics_survive_an_exhausted_run_budget(
    monkeypatch: pytest.MonkeyPatch, port: str, summary: dict[str, object]
) -> None:
    monkeypatch.setattr(preview, "RUN_PREVIEW_MAX_BYTES", 10)
    kept, _ = run_executor._Budget().take({port: summary})
    assert kept[port] == summary
