"""`platform` schema 的全部 ORM 模型。

alembic 的 `env.py` 通过本文件收集元数据，故须维护 `__all__`：漏一个即迁移漏表。
"""

from platform_server.apps.hvac.models.ac_unit import AcUnit
from platform_server.apps.hvac.models.base import Base
from platform_server.apps.hvac.models.room import Room
from platform_server.apps.hvac.models.workshop import Workshop

__all__ = ["AcUnit", "Base", "Room", "Workshop"]
