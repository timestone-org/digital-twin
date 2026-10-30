"""管理查询、归档恢复与受修订保护的部署切换契约。"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Self

from pydantic import Field, model_validator

from platform_server.apps.modeling.protocols import ModelTask, RunStatus
from platform_server.apps.modeling.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)
from platform_server.apps.modeling.schemas.deployment import ModelDeploymentCode


class ManagementListQuery(InputModel):
    pagination: Literal["page", "cursor"] = "page"
    page: int = Field(default=1, ge=1)
    size: int = Field(default=20, ge=1, le=200)
    after: str | None = Field(default=None, max_length=4096)
    limit: int = Field(default=100, ge=1, le=200)
    q: str | None = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def validate_pagination(self) -> Self:
        if self.pagination == "page" and self.after is not None:
            raise ValueError("after 仅用于 pagination=cursor")
        return self


class InstanceListQuery(ManagementListQuery):
    code: str | None = Field(default=None, max_length=64)
    template_id: uuid.UUID | None = None
    latest_run_status: RunStatus | None = None
    has_runs: bool | None = None
    archived: Literal["active", "archived", "all"] = "active"


class HistoryListQuery(ManagementListQuery):
    instance_id: uuid.UUID | None = None
    pipeline_id: uuid.UUID | None = None
    created_since: datetime | None = Field(
        default=None, alias="created_at__gte"
    )
    created_until: datetime | None = Field(default=None, alias="created_at__lt")

    @model_validator(mode="after")
    def validate_history(self) -> Self:
        if (
            self.instance_id
            and self.pipeline_id
            and self.instance_id != self.pipeline_id
        ):
            raise ValueError("instance_id 与 pipeline_id 不一致")
        for value in (self.created_since, self.created_until):
            if value is not None and value.utcoffset() is None:
                raise ValueError("时间必须带时区")
        if (
            self.created_since
            and self.created_until
            and self.created_since >= self.created_until
        ):
            raise ValueError("起止时间区间无效")
        return self


class RunListQuery(HistoryListQuery):
    status: RunStatus | None = None


class VersionListQuery(HistoryListQuery):
    task: ModelTask | None = None
    is_servable: bool | None = None
    archived: Literal["active", "archived", "all"] = "active"


class ArchiveIn(InputModel):
    expected_revision: int | None = Field(default=None, ge=1)


class DeploymentSwitchIn(InputModel):
    expected_revision: int = Field(ge=1)
    model_version_id: uuid.UUID
    is_signature_change_confirmed: bool = False


class DeploymentRollbackIn(InputModel):
    expected_revision: int = Field(ge=1)
    switch_id: uuid.UUID
    is_signature_change_confirmed: bool = False


class DeploymentSwitchOut(OutputModel):
    id: uuid.UUID
    deployment_id: uuid.UUID | None
    deployment_code: str
    from_model_version_id: uuid.UUID
    to_model_version_id: uuid.UUID
    revision: int
    rollback_of_id: uuid.UUID | None
    is_signature_change_confirmed: bool
    created_by_name: str
    created_at: Utc


@dataclass(frozen=True)
class ManagementCursor:
    created_at: datetime
    identity: uuid.UUID


class CursorListQuery(ManagementListQuery):
    pagination: Literal["page", "cursor"] = "cursor"

    @model_validator(mode="after")
    def require_cursor(self) -> Self:
        if self.pagination != "cursor":
            raise ValueError("此集合只支持游标分页")
        return self


class DeploymentListQuery(InputModel):
    code: ModelDeploymentCode | None = None
    model_version_id: uuid.UUID | None = None
    instance_id: uuid.UUID | None = None
    is_enabled: bool | None = None
