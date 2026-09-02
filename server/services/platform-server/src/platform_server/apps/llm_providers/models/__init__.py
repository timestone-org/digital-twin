"""模型供应商的全部 ORM 模型。

alembic 的 `env.py` 通过本文件收集元数据，故须维护 `__all__`：漏一个即迁移漏表。
"""

from platform_server.apps.llm_providers.models.assignment import LlmAssignment
from platform_server.apps.llm_providers.models.base import Base
from platform_server.apps.llm_providers.models.provider import LlmProvider

__all__ = ["Base", "LlmAssignment", "LlmProvider"]
