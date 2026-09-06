"""生成任务与定时规则的公开契约。"""

import uuid
from typing import Literal

from pydantic import Field

from platform_server.apps.report.schemas.common import (
    Granularity,
    InputModel,
    Label,
    OutputModel,
    Utc,
)
from platform_server.apps.report.schemas.document import (
    DocumentNode,
    PageSettings,
)
from platform_server.apps.report.schemas.preview import PreviewOut


class RenderCreateIn(InputModel):
    """提交一次生成。"""

    template_id: uuid.UUID
    period: str = Field(min_length=1, max_length=16)
    granularity: Granularity | None = None


class RenderOut(OutputModel):
    """任务状态，成功之后才可下载。"""

    id: uuid.UUID
    template_id: uuid.UUID | None
    schedule_id: uuid.UUID | None
    period: str
    granularity: Granularity
    timezone: str
    kind: Literal["render", "import"]
    status: Literal["pending", "running", "succeeded", "failed"]
    warnings: list[str]
    error: str | None
    created_at: Utc
    started_at: Utc | None
    finished_at: Utc | None


class ImportResultOut(OutputModel):
    """Word 导入结果及丢失清单。"""

    doc_json: DocumentNode
    page_json: PageSettings
    dropped: list[str]


class RenderDetailOut(RenderOut):
    """已完成任务的试算快照或导入结果。"""

    preview: PreviewOut | None = None
    imported: ImportResultOut | None = None


class ScheduleBody(InputModel):
    """一个定时规则的定义。"""

    name: Label
    granularity: Granularity = "month"
    delay_hours: int = Field(default=24, ge=0, le=720)
    is_enabled: bool = True


class ScheduleCreateIn(ScheduleBody):
    """创建定时规则。"""

    template_id: uuid.UUID


class ScheduleUpdateIn(ScheduleBody):
    """按预期版本更新规则。"""

    expected_version: int = Field(ge=1)


class ScheduleOut(OutputModel):
    """规则与已生成水位。"""

    id: uuid.UUID
    template_id: uuid.UUID
    name: str
    granularity: Granularity
    delay_hours: int
    is_enabled: bool
    row_version: int
    last_run_period: str | None
    created_at: Utc
    updated_at: Utc


class ReportRuntimeOut(OutputModel):
    """真实生效的调度配置。"""

    is_schedule_enabled: bool
    timezone: str


class ImportTicketIn(InputModel):
    """Word 直传的大小声明。"""

    size_bytes: int = Field(ge=1, le=10 * 1024 * 1024)


class ImportTicketOut(OutputModel):
    """对象存储直传凭证。"""

    url: str
    fields: dict[str, str]
    object_key: str


class ImportStartIn(InputModel):
    """已上传原件的身份。"""

    object_key: str = Field(min_length=1, max_length=256)
