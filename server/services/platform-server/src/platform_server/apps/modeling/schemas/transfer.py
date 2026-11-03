"""流水线 JSON 迁移文档与导入预检契约。"""

from typing import Literal

from pydantic import Field, model_validator

from platform_server.apps.modeling.schemas.common import (
    InputModel,
    Label,
    Note,
    OutputModel,
    PipelineCode,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph

MAX_TRANSFER_BYTES = 2 * 1024 * 1024


class TransferPipeline(InputModel):
    """可迁移的流水线定义。"""

    code: PipelineCode
    name: Label
    description: Note | None = None
    graph: PipelineGraph


class TransferOperator(InputModel):
    """文档引用的算子契约版本。"""

    operator: str = Field(min_length=1, max_length=64)
    spec_version: str = Field(min_length=1, max_length=32)


class PipelineTransferDocument(InputModel):
    """不含运行、产物与部署的便携 JSON。"""

    format_version: Literal["1.0"]
    pipeline: TransferPipeline
    operators: list[TransferOperator] = Field(max_length=200)

    @model_validator(mode="after")
    def check_size(self) -> "PipelineTransferDocument":
        if len(self.model_dump_json().encode()) > MAX_TRANSFER_BYTES:
            raise ValueError("流水线 JSON 不能超过 2 MB")
        return self


class PipelineImportIn(InputModel):
    """将文档导入成一条独立流水线。"""

    document: PipelineTransferDocument
    code: PipelineCode
    name: Label
    description: Note | None = None


class TransferIssue(OutputModel):
    """预检中可定位的问题与待配置提示。"""

    level: Literal["error", "warning"]
    message: str
    node_id: str = ""
    edge_id: str = ""


class PipelineImportInspection(OutputModel):
    """无副作用的导入预检结果。"""

    document: PipelineTransferDocument
    can_import: bool
    issues: list[TransferIssue]
    source_table_codes: list[str]
    node_count: int
    edge_count: int
