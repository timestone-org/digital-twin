"""文档 AST、指标和页面设置；动态编辑器属性在边界约束为 JSON。"""

from typing import Literal

from pydantic import ConfigDict, Field, JsonValue, model_validator

from platform_server.apps.report.schemas.common import (
    Aggregation,
    InputModel,
    Label,
)


class DocumentMark(InputModel):
    """富文本标记。"""

    type: str = Field(min_length=1, max_length=64)
    attrs: dict[str, JsonValue] = Field(default_factory=dict[str, JsonValue])


class DocumentNode(InputModel):
    """编辑器节点。"""

    model_config = ConfigDict(
        extra="forbid", json_schema_mode_override="validation"
    )

    type: str = Field(min_length=1, max_length=64)
    text: str | None = Field(default=None, max_length=100_000)
    attrs: dict[str, JsonValue] = Field(default_factory=dict[str, JsonValue])
    marks: list[DocumentMark] = Field(
        default_factory=list[DocumentMark], max_length=20
    )
    content: list["DocumentNode"] = Field(
        default_factory=list["DocumentNode"], max_length=2000
    )


class MetricDef(InputModel):
    """具名取数口径或派生表达式。"""

    name: str = Field(min_length=1, max_length=64, pattern=r"^[^{}\s][^{}]*$")
    table: str | None = Field(default=None, max_length=64)
    key: str | None = Field(default=None, max_length=64)
    mode: Literal["latest", "at_bucket", "window_agg", "expr"] = "window_agg"
    agg: Aggregation = "avg"
    offset: int = Field(default=0, ge=-120, le=120)
    window: str | None = Field(default=None, max_length=16)
    anchor: Literal["period", "latest"] = "period"
    expr: str | None = Field(default=None, max_length=2000)
    unit: str | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def check_mode(self) -> "MetricDef":
        if self.mode == "expr":
            if not self.expr or not self.expr.strip():
                raise ValueError("派生指标必须填写表达式")
        elif not self.table or not self.key:
            raise ValueError("数据指标必须选择台账和列")
        return self


class Margins(InputModel):
    """纸张边距，单位厘米。"""

    top: float = Field(default=2.54, ge=0, le=10)
    bottom: float = Field(default=2.54, ge=0, le=10)
    left: float = Field(default=3.18, ge=0, le=10)
    right: float = Field(default=3.18, ge=0, le=10)


class Watermark(InputModel):
    """文本水印。"""

    text: str = Field(default="", max_length=128)
    font_size_pt: float = Field(default=36, ge=8, le=100)
    rotation: int = Field(default=-45, ge=-180, le=180)


class PageSettings(InputModel):
    """Word 页面设置。"""

    size: Literal["A4", "A3", "Letter", "Legal", "custom"] = "A4"
    orientation: Literal["portrait", "landscape"] = "portrait"
    width_cm: float = Field(default=21, ge=5, le=60)
    height_cm: float = Field(default=29.7, ge=5, le=60)
    margins_cm: Margins = Margins()
    header: str = Field(default="", max_length=1000)
    footer: str = Field(default="", max_length=1000)
    font_family: Label = "宋体"
    font_size_pt: float = Field(default=12, ge=6, le=72)
    watermark: Watermark | None = None
    is_toc_enabled: bool = False
