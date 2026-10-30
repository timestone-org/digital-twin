"""模板、实例及完整参数配置契约。"""

import uuid

from pydantic import Field, JsonValue

from platform_server.apps.modeling.models.deployment import MAX_ROWS_CEILING
from platform_server.apps.modeling.schemas.common import (
    InputModel,
    Label,
    Note,
    OutputModel,
    PipelineCode,
    Utc,
)
from platform_server.apps.modeling.schemas.deployment import ModelDeploymentCode
from platform_server.apps.modeling.schemas.operator import OperatorOut
from platform_server.apps.modeling.schemas.run import RunSummaryOut


class ModelingConfiguration(InputModel):
    """节点 ID 到完整参数对象的映射。"""

    nodes: dict[str, dict[str, JsonValue]] = Field(max_length=200)


class ModelingParameterNodeOut(OutputModel):
    id: str
    alias: str
    operator: OperatorOut
    config: dict[str, JsonValue]
    known_columns: list[str] | None


class ModelingConfigurationOut(OutputModel):
    configuration: ModelingConfiguration
    json_schema: dict[str, JsonValue]
    nodes: list[ModelingParameterNodeOut]
    instance: "ModelingInstanceOut | None" = None


class ModelingTemplateCreateIn(InputModel):
    pipeline_id: uuid.UUID
    name: Label
    description: Note | None = None


class ModelingTemplateUpdateIn(InputModel):
    is_enabled: bool


class ModelingTemplateOut(OutputModel):
    id: uuid.UUID
    pipeline_id: uuid.UUID
    code: str
    name: str
    description: str | None
    version: int
    node_count: int
    is_enabled: bool
    created_by_name: str
    created_at: Utc
    updated_at: Utc


class ModelingInstanceCreateIn(InputModel):
    template_id: uuid.UUID
    code: PipelineCode
    name: Label
    description: Note | None = None
    configuration: ModelingConfiguration | None = None


class ModelingInstanceConfigureIn(InputModel):
    expected_revision: int = Field(ge=1)
    configuration: ModelingConfiguration
    name: Label | None = None
    description: Note | None = None


class ModelingInstanceOut(OutputModel):
    id: uuid.UUID
    code: str
    name: str
    description: str | None
    template_id: uuid.UUID
    template_name: str
    template_version: int
    revision: int
    latest_run: RunSummaryOut | None
    created_at: Utc
    updated_at: Utc
    archived_at: Utc | None = None


class ModelingInstanceDeployIn(InputModel):
    model_version_id: uuid.UUID
    code: ModelDeploymentCode
    name: Label
    description: Note | None = None
    max_rows_per_call: int = Field(default=200, ge=1, le=MAX_ROWS_CEILING)
    rate_limit_per_minute: int = Field(default=60, ge=1, le=6000)
