"""聚类的有界质量指标与结果讲解。"""

from collections import Counter
from dataclasses import dataclass
from typing import Protocol, cast

import numpy as np

from platform_server.apps.modeling.operators.reporting import (
    BlockAt,
    ReportBlock,
    RowCounts,
    Scale,
    annotated,
    breakdown_block,
    rows_block,
)
from platform_server.apps.modeling.operators.unsupervised_config import (
    ClusteringConfig,
)
from platform_server.apps.modeling.operators.unsupervised_data import Matrix
from platform_server.apps.modeling.operators.unsupervised_native import (
    silhouette,
)

MIN_SILHOUETTE_CLUSTERS = 2


class _MixtureStats(Protocol):
    def aic(self, rows: Matrix) -> float: ...
    def bic(self, rows: Matrix) -> float: ...


@dataclass(frozen=True)
class ClusterSummary:
    labels: tuple[int, ...]
    features: int
    silhouette: float | None
    silhouette_rows: int
    inertia: float | None
    aic: float | None
    bic: float | None
    warning_count: int


def summary_of(
    config: ClusteringConfig,
    rows: Matrix,
    labels: list[int],
    estimator: object,
    warning_count: int,
) -> ClusterSummary:
    silhouette, sample_rows = _silhouette(config, rows, labels)
    mixture = cast(_MixtureStats, estimator)
    return ClusterSummary(
        tuple(labels),
        rows.shape[1],
        silhouette,
        sample_rows,
        _finite_number(getattr(estimator, "inertia_", None)),
        (
            _finite_number(mixture.aic(rows))
            if config.algorithm == "gaussian_mixture"
            else None
        ),
        (
            _finite_number(mixture.bic(rows))
            if config.algorithm == "gaussian_mixture"
            else None
        ),
        warning_count,
    )


def _finite_number(value: object) -> float | None:
    if isinstance(value, (int, float, np.float64)) and np.isfinite(value):
        return float(value)
    return None


def _silhouette(
    config: ClusteringConfig, rows: Matrix, labels: list[int]
) -> tuple[float | None, int]:
    seats = [seat for seat, label in enumerate(labels) if label != -1]
    if len(seats) > config.silhouette_rows:
        random = np.random.default_rng(config.random_state)
        seats = sorted(
            int(seat)
            for seat in random.choice(
                seats, config.silhouette_rows, replace=False
            )
        )
    chosen = [labels[seat] for seat in seats]
    if not MIN_SILHOUETTE_CLUSTERS <= len(set(chosen)) < len(chosen):
        return None, len(seats)
    metric = (
        config.metric
        if config.algorithm == "agglomerative" and config.linkage != "ward"
        else "euclidean"
    )
    try:
        score = silhouette(rows[seats], chosen, metric)
    except ValueError:
        return None, len(seats)
    return _finite_number(score), len(seats)


def cluster_metrics(summary: ClusterSummary) -> dict[str, float | None]:
    labels = summary.labels
    return {
        "rows": float(len(labels)),
        "feature_count": float(summary.features),
        "cluster_count": float(len(set(labels) - {-1})),
        "noise_rows": float(labels.count(-1)),
        "noise_ratio": labels.count(-1) / len(labels),
        "silhouette": summary.silhouette,
        "silhouette_rows": float(summary.silhouette_rows),
        "inertia": summary.inertia,
        "aic": summary.aic,
        "bic": summary.bic,
        "warning_count": float(summary.warning_count),
    }


def cluster_report(
    summary: ClusterSummary, output: str
) -> tuple[ReportBlock, ...]:
    count = len(summary.labels)
    items = [
        {"name": "噪声(-1)" if label == -1 else f"簇 {label}", "value": total}
        for label, total in sorted(Counter(summary.labels).items())
    ]
    distribution = breakdown_block(
        BlockAt(
            zone="charts", title="本批次聚类分布", port="frame", is_primary=True
        ),
        Scale(
            label="标签仅在本次运行内有意义，不代表大小、顺序或故障种类",
            unit="行",
        ),
        items,
    )
    notes = [
        "批量探索分析，不产出可发布的单行模型；跨运行的相同簇号不代表相同群体",
        f"标签保存在「{output}」；轮廓系数排除噪声，并在固定种子的最多{summary.silhouette_rows}行上计算",
    ]
    if summary.silhouette is None:
        notes.append("当前样本不足两簇、全部为噪声或指标无定义，轮廓系数留空")
    if summary.warning_count:
        notes.append(
            "算法提示收敛或数据退化问题，请核对实际簇数并调整样本与参数"
        )
    return (
        rows_block(
            BlockAt(zone="step", title="本批次聚类行数", port="frame"),
            RowCounts(before=count, after=count),
        ),
        annotated(distribution, "alert", notes),
    )
