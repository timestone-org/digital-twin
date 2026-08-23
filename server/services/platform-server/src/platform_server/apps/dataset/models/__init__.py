"""数据台账的全部 ORM 模型。

alembic 的 `env.py` 通过本文件收集元数据，故须维护 `__all__`：漏一个即迁移漏表。
"""

from platform_server.apps.dataset.models.base import Base
from platform_server.apps.dataset.models.column import (
    KEY_PATTERN,
    MAX_DECIMALS,
    MAX_FORMULA_LENGTH,
    DatasetColumn,
)
from platform_server.apps.dataset.models.record import DatasetRecord
from platform_server.apps.dataset.models.table import (
    MAX_INTERVAL_MS,
    MIN_INTERVAL_MS,
    DatasetTable,
)

__all__ = [
    "KEY_PATTERN",
    "MAX_DECIMALS",
    "MAX_FORMULA_LENGTH",
    "MAX_INTERVAL_MS",
    "MIN_INTERVAL_MS",
    "Base",
    "DatasetColumn",
    "DatasetRecord",
    "DatasetTable",
]
