"""数据访问层。只做查询与挂载实体，**不提交**——事务边界归 service 层。"""

from platform_server.apps.dataset.crud.column import (
    ColumnCrud,
    column_crud,
)
from platform_server.apps.dataset.crud.record import (
    CollectedRow,
    RecordCrud,
    RecordWindow,
    WholeStatsRow,
    record_crud,
)
from platform_server.apps.dataset.crud.table import (
    TableCrud,
    table_crud,
)

__all__ = [
    "CollectedRow",
    "ColumnCrud",
    "RecordCrud",
    "RecordWindow",
    "TableCrud",
    "WholeStatsRow",
    "column_crud",
    "record_crud",
    "table_crud",
]
