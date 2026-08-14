"""项目面的入参与出参。"""

import uuid
from typing import Any, ClassVar

from pydantic import Field

from platform_server.apps.dashboard.schemas.common import (
    InputModel,
    Label,
    OutputModel,
    UpdateModel,
    Utc,
)


class ProjectOut(OutputModel):
    """项目详情。`dashboard_count` 让列表页一眼看出规模。"""

    id: uuid.UUID
    name: str
    description: str | None
    theme_json: dict[str, Any]
    brand_json: dict[str, Any]
    dashboard_count: int
    created_at: Utc
    updated_at: Utc


class ProjectCreateIn(InputModel):
    """建项目。"""

    name: Label
    description: str | None = Field(default=None, max_length=1024)
    theme_json: dict[str, Any] = Field(default_factory=dict[str, Any])
    brand_json: dict[str, Any] = Field(default_factory=dict[str, Any])


class ProjectUpdateIn(UpdateModel):
    """改项目。缺省的字段表示本次不涉及。"""

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {"name", "theme_json", "brand_json"}
    )

    name: Label | None = None
    description: str | None = Field(default=None, max_length=1024)
    theme_json: dict[str, Any] | None = None
    brand_json: dict[str, Any] | None = None
