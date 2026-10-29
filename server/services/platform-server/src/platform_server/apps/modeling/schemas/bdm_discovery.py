"""能管配置能力与指标来源绑定的外部边界、平台出参。"""

from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from platform_server.apps.modeling.schemas.common import OutputModel


class BdmCapabilitiesOut(OutputModel):
    is_configured: bool
    timezone: str | None
    minute_intervals: list[int]
    max_identifiers: int
    max_formula_identifiers: int
    max_rows: int
    load_timeout_s: float | None


class BdmIndicatorQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=100_000)
    size: int = Field(default=50, ge=1, le=200)
    code: str = Field(default="", max_length=200)


class BdmIndicatorSourceWire(BaseModel):
    model_config = ConfigDict(strict=True)
    source_type: str = Field(alias="sourceType", min_length=1)
    source_id: str | None = Field(default=None, alias="sourceId")
    source_property: str | None = Field(default=None, alias="sourceProperty")
    alias: str | None = None
    unit: str | None = None


class BdmIndicatorWire(BaseModel):
    model_config = ConfigDict(strict=True)
    id: str = Field(min_length=1)
    code: str = Field(min_length=1)
    name: str
    unit: str | None = None
    sources: list[BdmIndicatorSourceWire]


class BdmIndicatorPageWire(BaseModel):
    total: int = Field(default=0, ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(alias="pageSize", ge=1, le=200)
    items: list[BdmIndicatorWire] = Field(max_length=200)

    @model_validator(mode="after")
    def validate_total(self) -> Self:
        if self.items and "total" not in self.model_fields_set:
            raise ValueError("非空目录必须返回总数")
        return self


class BdmIndicatorSourceOut(OutputModel):
    source_type: str
    source_id: str | None
    source_property: str | None
    alias: str | None
    unit: str | None
    is_selectable: bool


class BdmIndicatorOut(OutputModel):
    id: str
    code: str
    name: str
    unit: str | None
    sources: list[BdmIndicatorSourceOut]


class BdmIndicatorsOut(OutputModel):
    total: int
    page: int
    size: int
    items: list[BdmIndicatorOut]
