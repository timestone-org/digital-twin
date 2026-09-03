"""数据台账的服务面。跨功能模块只走这里，不许深链到内部文件。

事务边界在这一层：crud 不提交，api 不写业务。
"""

# 跨功能模块要用的三个形状与那份键的字符集。⚠ 让出来是刻意的：建模那一侧
# 要建库公式条目，而「只走 services 公开面」这条规矩不许它深链进
# `dataset/schemas` 与 `dataset/models`
from platform_server.apps.dataset.models import KEY_PATTERN
from platform_server.apps.dataset.schemas import (
    FormulaCreateIn,
    FormulaDefOut,
    FormulaParamSpec,
)
from platform_server.apps.dataset.services import (
    backfill_service,
    column_service,
    formula_library,
    formula_service,
    formula_usage,
    library_service,
    record_overrides,
    record_read,
    record_write,
    table_service,
)
from platform_server.apps.dataset.services.analysis_provider import (
    AnalysisModel,
    AnalysisProvider,
    AnalysisUnavailable,
    LoadedModels,
    register_provider,
    registered_providers,
)
from platform_server.apps.dataset.services.backfill_jobs import (
    BackfillJobs,
    BackfillJobState,
)
from platform_server.apps.dataset.services.backfill_service import (
    BackfillRunner,
)
from platform_server.apps.dataset.services.column_service import ColumnSpec
from platform_server.apps.dataset.services.dirty import (
    DIRTY_TABLES_KEY,
    DatasetDirtyLog,
)
from platform_server.apps.dataset.services.record_read import (
    EffectiveRow,
    EffectiveScan,
    EffectiveWindow,
    RecordFilters,
)
from platform_server.apps.dataset.services.record_values import Actor
from platform_server.apps.dataset.services.record_write import (
    RecordLocator,
    RecordWriter,
)
from platform_server.apps.dataset.services.sessions import Sessions

__all__ = [
    "DIRTY_TABLES_KEY",
    "KEY_PATTERN",
    "Actor",
    "AnalysisModel",
    "AnalysisProvider",
    "AnalysisUnavailable",
    "BackfillJobState",
    "BackfillJobs",
    "BackfillRunner",
    "ColumnSpec",
    "DatasetDirtyLog",
    "EffectiveRow",
    "EffectiveScan",
    "EffectiveWindow",
    "FormulaCreateIn",
    "FormulaDefOut",
    "FormulaParamSpec",
    "LoadedModels",
    "RecordFilters",
    "RecordLocator",
    "RecordWriter",
    "Sessions",
    "backfill_service",
    "column_service",
    "formula_library",
    "formula_service",
    "formula_usage",
    "library_service",
    "record_overrides",
    "record_read",
    "record_write",
    "register_provider",
    "registered_providers",
    "table_service",
]
