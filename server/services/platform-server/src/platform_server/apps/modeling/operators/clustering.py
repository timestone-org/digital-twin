"""八种有界批量聚类，输出标签与分析结果，不封存模型版本。"""

import warnings

import numpy as np
from threadpoolctl import threadpool_limits

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    CONTRACT_METRICS,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.cluster_estimators import (
    CLUSTER_ROW_LIMITS,
    cluster_labels,
    create_cluster,
)
from platform_server.apps.modeling.operators.cluster_results import (
    ClusterSummary,
    cluster_metrics,
    cluster_report,
    summary_of,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    DTYPE_STRING,
    ROLE_FEATURE,
    ROLE_IGNORED,
    Frame,
    FrameColumn,
    frame_input,
)
from platform_server.apps.modeling.operators.payloads import MetricsPayload
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.operators.tabular import appended
from platform_server.apps.modeling.operators.unsupervised_config import (
    ClusteringConfig,
)
from platform_server.apps.modeling.operators.unsupervised_data import (
    Matrix,
    fit_scaling,
    numeric_matrix,
    scaled,
)

MIN_CLUSTER_ROWS = 2
MAX_CLUSTER_FEATURES = 32
MAX_OUTPUT_COLUMNS = 256
MAX_MIXTURE_CELLS = 10_000_000


@register_operator
class ClusteringAnalysis(OperatorBase):
    CODE = "clustering_analysis"
    NAME = "批量聚类分析"
    DESCRIPTION = (
        "K均值、混合、密度、层次等八种批量聚类；"
        "输出标签与质量指标，不发布单行模型"
    )
    CATEGORY = "model"
    ICON = "network"
    CONFIG_MODEL = ClusteringConfig
    INPUTS = (
        PortSpec(name="frame", contract=CONTRACT_FRAME, label="分析样本"),
    )
    OUTPUTS = (
        PortSpec(
            name="frame", contract=CONTRACT_FRAME, label="带聚类标签的数据"
        ),
        PortSpec(name="metrics", contract=CONTRACT_METRICS, label="聚类概况"),
    )
    ENABLED_IN_SERVING = False
    REQUIRES_FIT = True

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._clustering = ClusteringConfig.model_validate(config.model_dump())
        self._summary: ClusterSummary | None = None

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        parsed = ClusteringConfig.model_validate(config.model_dump())
        known = inputs.get("frame")
        return {
            "frame": None if known is None else (*known, parsed.output_column)
        }

    def run(self, inputs: dict[str, object]) -> dict[str, object]:
        frame = frame_input(inputs, "frame")
        config = self._clustering
        rows = self._matrix(frame)
        try:
            with (
                warnings.catch_warnings(record=True) as captured,
                threadpool_limits(limits=1),
            ):
                estimator = create_cluster(config, rows)
                labels = cluster_labels(estimator, rows)
                summary = summary_of(
                    config, rows, labels, estimator, len(captured)
                )
        except (ValueError, np.linalg.LinAlgError) as error:
            raise OperatorError(
                "聚类无法处理当前样本，请检查数值尺度、样本数量与算法参数"
            ) from error
        self._summary = summary
        output = appended(
            frame,
            [
                FrameColumn(
                    key=config.output_column,
                    name="聚类标签",
                    dtype=DTYPE_STRING,
                    role=ROLE_IGNORED,
                )
            ],
            [[str(label) for label in labels]],
        )
        return {
            "frame": output,
            "metrics": MetricsPayload(
                task="clustering", metrics=cluster_metrics(summary)
            ),
        }

    def _matrix(self, frame: Frame) -> Matrix:
        config = self._clustering
        if self.split_plan is not None:
            raise OperatorError(
                "批量聚类用于探索分析，请放在独立分支，不能放在训练切分之前"
            )
        limit = CLUSTER_ROW_LIMITS[config.algorithm]
        if not MIN_CLUSTER_ROWS <= frame.row_count <= limit:
            raise OperatorError(
                f"{config.algorithm}需要2到{limit}行，请先显式抽样或缩小范围"
            )
        if (
            config.output_column in frame.keys
            or len(frame.columns) >= MAX_OUTPUT_COLUMNS
        ):
            raise OperatorError(
                "聚类标签列已存在或输出列数超过256，请修改输出列名或先选列"
            )
        keys = tuple(config.columns) or tuple(
            column.key
            for column in frame.columns
            if column.dtype == DTYPE_NUMBER and column.role == ROLE_FEATURE
        )
        if not 1 <= len(keys) <= MAX_CLUSTER_FEATURES or any(
            frame.column_of(key).role != ROLE_FEATURE for key in keys
        ):
            raise OperatorError("聚类需要1到32个数值特征列，目标列不能参与")
        if (
            config.algorithm not in {"dbscan", "mean_shift"}
            and config.n_clusters > frame.row_count
        ):
            raise OperatorError("簇数不能超过样本行数")
        if (
            config.algorithm == "gaussian_mixture"
            and frame.row_count * len(keys) * config.n_clusters
            > MAX_MIXTURE_CELLS
        ):
            raise OperatorError(
                "混合模型的样本、特征与簇数乘积过大，请缩小数据或簇数"
            )
        rows = numeric_matrix(frame, keys)
        return (
            scaled(rows, *fit_scaling(rows, 1e-9))
            if config.should_standardize
            else rows
        )

    def report(self) -> tuple[ReportBlock, ...]:
        return (
            ()
            if self._summary is None
            else cluster_report(self._summary, self._clustering.output_column)
        )
