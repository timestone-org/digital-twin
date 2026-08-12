"""`platform` schema 的全部 ORM 模型。

alembic 的 `env.py` 通过本文件收集元数据，故须维护 `__all__`：漏一个即迁移漏表。
"""

from platform_server.apps.hvac.models.ac_data_binding import AcDataBinding
from platform_server.apps.hvac.models.ac_metric_limit import AcMetricLimit
from platform_server.apps.hvac.models.ac_startup_batch import AcStartupBatch
from platform_server.apps.hvac.models.ac_startup_episode import (
    AcStartupEpisode,
)
from platform_server.apps.hvac.models.ac_startup_exclusion import (
    AcStartupExclusion,
)
from platform_server.apps.hvac.models.ac_startup_shard import AcStartupShard
from platform_server.apps.hvac.models.ac_unit import AcUnit
from platform_server.apps.hvac.models.base import Base
from platform_server.apps.hvac.models.room import Room
from platform_server.apps.hvac.models.workshop import Workshop

__all__ = [
    "AcDataBinding",
    "AcMetricLimit",
    "AcStartupBatch",
    "AcStartupEpisode",
    "AcStartupExclusion",
    "AcStartupShard",
    "AcUnit",
    "Base",
    "Room",
    "Workshop",
]
