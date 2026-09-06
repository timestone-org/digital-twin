"""报告模板管理契约。"""

import uuid

from pydantic import Field

from platform_server.apps.report.schemas.common import (
    Code,
    Granularity,
    InputModel,
    Label,
    OutputModel,
    Utc,
)
from platform_server.apps.report.schemas.document import (
    DocumentNode,
    MetricDef,
    PageSettings,
)


class TemplateBody(InputModel):
    """一份完整模板定义。"""

    name: Label
    description: str | None = Field(default=None, max_length=2000)
    granularity: Granularity = "month"
    is_enabled: bool = True
    doc_json: DocumentNode = DocumentNode(type="doc")
    metrics: list[MetricDef] = Field(
        default_factory=list[MetricDef], max_length=200
    )
    page_json: PageSettings = PageSettings()


class ReportTemplateCreateIn(TemplateBody):
    """创建模板。"""

    code: Code


class TemplateUpdateIn(TemplateBody):
    """整份保存并校验读到的版本。"""

    expected_version: int = Field(ge=1)


class ReportTemplateSummaryOut(OutputModel):
    """模板列表项。"""

    id: uuid.UUID
    code: str
    name: str
    description: str | None
    granularity: Granularity
    is_enabled: bool
    row_version: int
    created_at: Utc
    updated_at: Utc


class ReportTemplateOut(ReportTemplateSummaryOut):
    """完整模板。"""

    doc_json: DocumentNode
    metrics: list[MetricDef]
    page_json: PageSettings
