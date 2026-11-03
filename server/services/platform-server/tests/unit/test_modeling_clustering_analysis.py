"""八种聚类的真实分群、数据保护、退化指标与资源边界。"""

import math
from dataclasses import replace

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    MetricsPayload,
    OperatorError,
    registry,
)

ALGORITHMS = (
    "kmeans",
    "minibatch_kmeans",
    "gaussian_mixture",
    "dbscan",
    "agglomerative",
    "birch",
    "mean_shift",
    "spectral",
)


def source(rows: int = 90) -> Frame:
    return Frame(
        columns=(
            FrameColumn("x", "横轴", "number"),
            FrameColumn("y", "纵轴", "number"),
        ),
        rows=tuple(
            (
                (seat % 3) * 10 + math.sin(seat) * 0.1,
                (seat % 3) * -10 + math.cos(seat) * 0.1,
            )
            for seat in range(rows)
        ),
        index=tuple(range(rows)),
    )


def run(config: dict[str, object], frame: Frame | None = None):
    operator, _ = registry.build("clustering_analysis", config)
    result = operator.run({"frame": source() if frame is None else frame})
    return operator, result


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_all_algorithms_compute_real_clusters_and_preserve_input(
    algorithm: str,
) -> None:
    frame = source()
    operator, result = run({"algorithm": algorithm}, frame)
    output, metrics = result["frame"], result["metrics"]
    assert isinstance(output, Frame)
    assert isinstance(metrics, MetricsPayload)
    assert output.keys == ("x", "y", "cluster_id")
    assert output.index == frame.index
    assert tuple(row[:2] for row in output.rows) == frame.rows
    assert output.columns[-1].dtype == "string"
    assert output.columns[-1].role == "ignored"
    assert {row[-1] for row in output.rows} == {"0", "1", "2"}
    assert metrics.metrics["cluster_count"] == 3
    assert metrics.metrics["silhouette"] > 0.9
    assert "model" not in result
    assert operator.trained_estimator() is None
    assert {block.zone for block in operator.report()} >= {"step", "charts"}


def test_dbscan_noise_is_preserved_and_undefined_silhouette_is_null() -> None:
    _, result = run({"algorithm": "dbscan", "eps": 1e-9, "min_samples": 5})
    assert all(row[-1] == "-1" for row in result["frame"].rows)
    metrics = result["metrics"].metrics
    assert metrics["cluster_count"] == 0
    assert metrics["noise_rows"] == 90
    assert metrics["noise_ratio"] == 1
    assert metrics["silhouette"] is None


def test_one_cluster_and_one_label_per_row_have_no_fake_quality_score() -> None:
    _, single = run({"n_clusters": 1})
    assert single["metrics"].metrics["silhouette"] is None
    _, individual = run({"n_clusters": 2}, source(2))
    assert individual["metrics"].metrics["silhouette"] is None


@pytest.mark.parametrize(
    "value", [None, True, float("nan"), float("inf"), 1e101]
)
def test_missing_nonfinite_and_boolean_samples_are_rejected(
    value: object,
) -> None:
    frame = source()
    broken = replace(frame, rows=((value, 1.0), *frame.rows[1:]))
    with pytest.raises(OperatorError):
        run({}, broken)


@pytest.mark.parametrize(
    "kind", ["rows", "count", "columns", "collision", "role", "split", "text"]
)
def test_invalid_configuration_or_input_is_rejected_before_fitting(
    kind: str,
) -> None:
    frame = source()
    config: dict[str, object] = {}
    if kind == "rows":
        frame = source(1)
    if kind == "count":
        config["n_clusters"] = 64
        frame = source(3)
    if kind == "columns":
        config["columns"] = ["x", "x"]
    if kind == "collision":
        config["output_column"] = "x"
    if kind == "role":
        frame = replace(
            frame,
            columns=(
                replace(frame.columns[0], role="target"),
                frame.columns[1],
            ),
        )
        config["columns"] = ["x"]
    if kind == "text":
        frame = replace(
            frame,
            columns=(
                replace(frame.columns[0], dtype="string"),
                frame.columns[1],
            ),
        )
        config["columns"] = ["x"]
    operator, _ = registry.build("clustering_analysis", config)
    if kind == "split":
        operator.bind_runtime(
            tz_offset_minutes=0, split_plan={"method": "time_order"}
        )
    with pytest.raises(OperatorError):
        operator.run({"frame": frame})


@pytest.mark.parametrize(
    ("algorithm", "rows"),
    [
        ("dbscan", 4001),
        ("agglomerative", 3001),
        ("mean_shift", 3001),
        ("spectral", 1501),
    ],
)
def test_expensive_algorithms_have_their_own_explicit_row_limit(
    algorithm: str, rows: int
) -> None:
    with pytest.raises(OperatorError, match="显式抽样"):
        run({"algorithm": algorithm}, source(rows))


@pytest.mark.parametrize(
    "config",
    [
        {
            "algorithm": "agglomerative",
            "linkage": "average",
            "metric": "manhattan",
        },
        {
            "algorithm": "spectral",
            "affinity": "nearest_neighbors",
            "n_neighbors": 5,
        },
        {
            "algorithm": "mean_shift",
            "bandwidth_mode": "fixed",
            "bandwidth": 0.5,
        },
        {"algorithm": "gaussian_mixture", "covariance_type": "full"},
    ],
)
def test_algorithm_specific_settings_are_actually_executed(
    config: dict[str, object],
) -> None:
    _, result = run(config)
    assert result["frame"].row_count == 90
    assert result["metrics"].metrics["cluster_count"] == 3


def test_sampled_quality_and_labels_are_reproducible() -> None:
    first, result = run({"silhouette_rows": 20})
    second, replay = run({"silhouette_rows": 20})
    assert result["frame"].rows == replay["frame"].rows
    assert result["metrics"].metrics == replay["metrics"].metrics
    assert first.report() == second.report()
    assert result["metrics"].metrics["silhouette_rows"] == 20


def test_mixture_reports_information_criteria_and_preserves_units() -> None:
    frame = source()
    _, result = run(
        {"algorithm": "gaussian_mixture", "should_standardize": False}, frame
    )
    metrics = result["metrics"].metrics
    assert math.isfinite(metrics["aic"])
    assert math.isfinite(metrics["bic"])
    assert result["frame"].rows[0][:2] == frame.rows[0]


def test_constant_mean_shift_requires_a_meaningful_bandwidth() -> None:
    frame = replace(source(), rows=tuple((1.0, 1.0) for _ in range(90)))
    with pytest.raises(OperatorError, match="带宽"):
        run({"algorithm": "mean_shift"}, frame)
    _, result = run(
        {"algorithm": "mean_shift", "bandwidth_mode": "fixed"}, frame
    )
    assert result["metrics"].metrics["cluster_count"] == 1
    assert result["metrics"].metrics["silhouette"] is None


@pytest.mark.parametrize(
    "config",
    [
        {"algorithm": "unknown"},
        {"n_clusters": 0},
        {"eps": 0},
        {"silhouette_rows": 2001},
        {"gamma": float("nan")},
    ],
)
def test_schema_rejects_invalid_algorithm_and_unbounded_parameters(
    config: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        registry.build("clustering_analysis", config)
