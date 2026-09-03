"""算子的显式登记清单。

⚠ **不自动扫包**：自动扫包会让「装了一个包就多出几个算子」，而算子清单是要被
契约测试逐条断言的（docs/MODELING_DESIGN.md §5.6）。加算子在这里加一行 import。
"""

from platform_server.apps.modeling.operators.base import (
    CATEGORIES,
    CONTRACT_FRAME,
    CONTRACT_METRICS,
    CONTRACT_MODEL,
    CONTRACTS,
    PREFETCHED_KEY,
    SERVING_CHANNELS,
    ColumnKeys,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    OperatorSpec,
    PortSpec,
)
from platform_server.apps.modeling.operators.cleaning import (
    AGG_FUNCS,
    CastType,
    DropMissing,
    FilterRows,
    Resample,
)
from platform_server.apps.modeling.operators.diagnostics import (
    FeatureImportance,
    ResidualAnalysis,
)
from platform_server.apps.modeling.operators.evaluate import (
    ClassificationMetrics,
    RegressionMetrics,
)
from platform_server.apps.modeling.operators.feature import (
    OneHot,
    Standardize,
)
from platform_server.apps.modeling.operators.frame import (
    COLUMN_ROLES,
    DTYPE_NUMBER,
    ROLE_FEATURE,
    ROLE_IGNORED,
    ROLE_TARGET,
    CellValue,
    Frame,
    FrameColumn,
    Provenance,
)
from platform_server.apps.modeling.operators.model import (
    LinearRegressionOperator,
    LogisticRegressionOperator,
    SplitDataset,
)
from platform_server.apps.modeling.operators.payloads import (
    MetricsPayload,
    ModelPayload,
)
from platform_server.apps.modeling.operators.preprocess import (
    ClipOutlier,
    FillMissing,
)
from platform_server.apps.modeling.operators.registry import (
    OperatorRegistry,
    OperatorRegistryError,
    register_operator,
    registry,
)
from platform_server.apps.modeling.operators.source import LedgerSource
from platform_server.apps.modeling.operators.timefeature import (
    TIME_PARTS,
    TimeFeature,
)
from platform_server.apps.modeling.operators.window import (
    ROLLING_STATS,
    LagFeature,
    RollingFeature,
)

__all__ = [
    "AGG_FUNCS",
    "CATEGORIES",
    "COLUMN_ROLES",
    "CONTRACTS",
    "CONTRACT_FRAME",
    "CONTRACT_METRICS",
    "CONTRACT_MODEL",
    "DTYPE_NUMBER",
    "PREFETCHED_KEY",
    "ROLE_FEATURE",
    "ROLE_IGNORED",
    "ROLE_TARGET",
    "ROLLING_STATS",
    "SERVING_CHANNELS",
    "TIME_PARTS",
    "CastType",
    "CellValue",
    "ClassificationMetrics",
    "ClipOutlier",
    "ColumnKeys",
    "ColumnsByPort",
    "DropMissing",
    "FeatureImportance",
    "FillMissing",
    "FilterRows",
    "Frame",
    "FrameColumn",
    "LagFeature",
    "LedgerSource",
    "LinearRegressionOperator",
    "LogisticRegressionOperator",
    "MetricsPayload",
    "ModelPayload",
    "OneHot",
    "OperatorBase",
    "OperatorConfig",
    "OperatorError",
    "OperatorRegistry",
    "OperatorRegistryError",
    "OperatorSpec",
    "PortSpec",
    "Provenance",
    "RegressionMetrics",
    "Resample",
    "ResidualAnalysis",
    "RollingFeature",
    "SplitDataset",
    "Standardize",
    "TimeFeature",
    "register_operator",
    "registry",
]
