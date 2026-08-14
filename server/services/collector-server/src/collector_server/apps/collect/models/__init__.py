"""ORM 模型，绑定 `collect` schema。

⚠ alembic 的 env.py 靠本文件收集元数据：新增一张表却没在这里导出，
迁移会漏掉它，而 autogenerate 不会报错。
"""

from collector_server.apps.collect.models.base import Base
from collector_server.apps.collect.models.point_history import PointHistory
from collector_server.apps.collect.models.source_state import SourceState

__all__ = ["Base", "PointHistory", "SourceState"]
