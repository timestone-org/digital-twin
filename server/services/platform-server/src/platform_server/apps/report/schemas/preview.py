"""试算与校验回执，精确值使用字符串。"""

from typing import Literal

from pydantic import Field

from platform_server.apps.report.schemas.common import (
    Granularity,
    InputModel,
    OutputModel,
    Utc,
)
from platform_server.apps.report.schemas.template import TemplateBody


class PreviewIn(InputModel):
    """已保存或未保存模板的试算参数。"""

    period: str = Field(min_length=1, max_length=16)
    granularity: Granularity | None = None
    draft: TemplateBody | None = None


class TemplateIssue(OutputModel):
    """定位到指标或节点的问题。"""

    scope: str
    where: str
    message: str
    is_blocking: bool = True


class ValidationOut(OutputModel):
    """模板校验结果。"""

    is_valid: bool
    issues: list[TemplateIssue]


class MetricValue(OutputModel):
    """指标结果及实际取数窗口。"""

    name: str
    value: str | bool | None
    value_kind: Literal["number", "text", "boolean", "empty"] = "empty"
    since: Utc | None = None
    until: Utc | None = None
    error: str | None = None
    is_truncated: bool = False
    is_stale: bool = False


class SeriesPoint(OutputModel):
    """图表里的一个测量点。"""

    ts: Utc
    value: str | None


class ChartSeries(OutputModel):
    """具名图表序列。"""

    name: str
    points: list[SeriesPoint]


class NodeValue(OutputModel):
    """业务节点的展示结果。"""

    kind: str
    text: str = ""
    title: str = ""
    columns: list[str] = Field(default_factory=list[str])
    rows: list[list[str]] = Field(default_factory=list[list[str]])
    series: list[ChartSeries] = Field(default_factory=list[ChartSeries])
    is_truncated: bool = False
    is_stale: bool = False


class PreviewOut(OutputModel):
    """模板试算全貌。"""

    is_valid: bool
    period: str
    timezone: str
    metrics: list[MetricValue]
    nodes: dict[str, NodeValue]
    warnings: list[str]
