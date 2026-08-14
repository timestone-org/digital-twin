"""数据访问层。只做查询与挂载实体，**不提交**——事务边界归 service 层。"""

from platform_server.apps.collect.crud.history import (
    HistoryCursor,
    HistorySource,
    HistoryWindow,
    PointRef,
    build_aggregate_query,
    build_range_query,
)
from platform_server.apps.collect.crud.point import PointCrud, point_crud
from platform_server.apps.collect.crud.source import SourceCrud, source_crud

__all__ = [
    "HistoryCursor",
    "HistorySource",
    "HistoryWindow",
    "PointCrud",
    "PointRef",
    "SourceCrud",
    "build_aggregate_query",
    "build_range_query",
    "point_crud",
    "source_crud",
]
