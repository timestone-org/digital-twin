"""算子的显式登记清单。

⚠ **不自动扫包**：自动扫包会让「装了一个包就多出几个算子」，而算子清单是要被
契约测试逐条断言的（docs/MODELING_DESIGN.md §5.6）。加算子在这里加一行 import。
"""

from platform_server.apps.modeling.operators.base import (
    CATEGORIES,
    CHANNEL_BINARY,
    CHANNEL_JSON,
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
    CastType,
    DropMissing,
    FilterRows,
)
from platform_server.apps.modeling.operators.diagnostics import (
    CrossValidate,
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
from platform_server.apps.modeling.operators.join import LedgerJoin
from platform_server.apps.modeling.operators.model import SplitDataset
from platform_server.apps.modeling.operators.payloads import (
    MetricsPayload,
    ModelPayload,
)
from platform_server.apps.modeling.operators.preprocess import (
    ClipOutlier,
    FillMissing,
)
from platform_server.apps.modeling.operators.reduction import (
    Pca,
    SelectFeature,
)
from platform_server.apps.modeling.operators.registry import (
    OperatorRegistry,
    OperatorRegistryError,
    register_operator,
    registry,
)
from platform_server.apps.modeling.operators.regression import (
    LinearRegressionOperator,
    LogisticRegressionOperator,
)
from platform_server.apps.modeling.operators.reporting import (
    BLOCK_KINDS,
    TIER_LARGE,
    TIER_SCALAR,
    TIER_SMALL,
    ZONES,
    BlockAt,
    BlockKind,
    CellChange,
    ColumnBins,
    ColumnChange,
    ModelStructure,
    Pdp,
    ReportBlock,
    RowCounts,
    Scale,
    TimeAxis,
    Zone,
    axis_block,
    bins_block,
    breakdown_block,
    cells_block,
    columns_block,
    fits_block,
    rows_block,
    structure_block,
)
from platform_server.apps.modeling.operators.resample import (
    AGG_FUNCS,
    Resample,
)
from platform_server.apps.modeling.operators.source import LedgerSource
from platform_server.apps.modeling.operators.timefeature import (
    TIME_PARTS,
    TimeFeature,
)
from platform_server.apps.modeling.operators.trees import TreeRegressor
from platform_server.apps.modeling.operators.window import (
    ROLLING_STATS,
    LagFeature,
    RollingFeature,
)

__all__ = [
    "AGG_FUNCS",
    "BLOCK_KINDS",
    "CATEGORIES",
    "CHANNEL_BINARY",
    "CHANNEL_JSON",
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
    "TIER_LARGE",
    "TIER_SCALAR",
    "TIER_SMALL",
    "TIME_PARTS",
    "ZONES",
    "BlockAt",
    "BlockKind",
    "CastType",
    "CellChange",
    "CellValue",
    "ClassificationMetrics",
    "ClipOutlier",
    "ColumnBins",
    "ColumnChange",
    "ColumnKeys",
    "ColumnsByPort",
    "CrossValidate",
    "DropMissing",
    "FeatureImportance",
    "FillMissing",
    "FilterRows",
    "Frame",
    "FrameColumn",
    "LagFeature",
    "LedgerJoin",
    "LedgerSource",
    "LinearRegressionOperator",
    "LogisticRegressionOperator",
    "MetricsPayload",
    "ModelPayload",
    "ModelStructure",
    "OneHot",
    "OperatorBase",
    "OperatorConfig",
    "OperatorError",
    "OperatorRegistry",
    "OperatorRegistryError",
    "OperatorSpec",
    "Pca",
    "Pdp",
    "PortSpec",
    "Provenance",
    "RegressionMetrics",
    "ReportBlock",
    "Resample",
    "ResidualAnalysis",
    "RollingFeature",
    "RowCounts",
    "Scale",
    "SelectFeature",
    "SplitDataset",
    "Standardize",
    "TimeAxis",
    "TimeFeature",
    "TreeRegressor",
    "Zone",
    "axis_block",
    "bins_block",
    "breakdown_block",
    "cells_block",
    "columns_block",
    "fits_block",
    "register_operator",
    "registry",
    "rows_block",
    "structure_block",
]
