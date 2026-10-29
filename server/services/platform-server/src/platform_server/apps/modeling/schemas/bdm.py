"""BDM 外部响应边界与平台目录出参。"""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

from platform_server.apps.modeling.schemas.common import OutputModel

type BdmKind = Literal["point", "raw", "formula"]
type BdmGranularity = Literal["day", "month", "hour", "minute"]


class BdmEnvelope(BaseModel):
    model_config = ConfigDict(strict=True)
    code: int
    data: dict[str, JsonValue] | None = None


class BdmSample(BaseModel):
    model_config = ConfigDict(strict=True)
    ct: str = Field(min_length=1, max_length=64)
    value: float | int | str | bool | None = None


class BdmSeries(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    point_id: str | None = Field(default=None, alias="pointId")
    property_id: str | None = Field(default=None, alias="propertyId")
    code: str | None = None
    name: str = ""
    node_name: str = Field(default="", alias="nodeName")
    property_name: str = Field(default="", alias="propertyName")
    unit: str = ""
    offset: int = Field(default=0, ge=0, le=100_000)
    next_offset: int | None = Field(default=None, alias="nextOffset", ge=0)
    samples: list[BdmSample] = Field(max_length=500)


class BdmSeriesData(BaseModel):
    kind: BdmKind | None = None
    series: list[BdmSeries] = Field(min_length=1, max_length=10)
    interval_minutes: int | None = Field(
        default=None, alias="intervalMinutes", ge=1, le=60
    )
    is_end_exclusive: bool | None = Field(
        default=None, alias="endExclusive", strict=True
    )


class BdmCatalogWire(BaseModel):
    total: int = Field(default=0, ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(alias="pageSize", ge=1, le=200)
    system_filter_available: bool | None = Field(
        default=None, alias="systemFilterAvailable"
    )
    items: list[dict[str, JsonValue]] = Field(max_length=200)

    @model_validator(mode="after")
    def validate_total(self) -> Self:
        if self.items and "total" not in self.model_fields_set:
            raise ValueError("非空目录必须返回总数")
        return self


class BdmSystemsWire(BaseModel):
    model_config = ConfigDict(strict=True)
    items: list[str]
    system_filter_available: bool = Field(alias="systemFilterAvailable")


class BdmCatalogQuery(BaseModel):
    kind: BdmKind = "point"
    page: int = Field(default=1, ge=1, le=100_000)
    size: int = Field(default=50, ge=1, le=200)
    name: str = Field(default="", max_length=100)
    keyword: str = Field(default="", max_length=100)
    system: str = Field(default="", max_length=100)
    code: str = Field(default="", max_length=200)
    should_include_unqueryable: bool = Field(
        default=False, alias="include_unqueryable"
    )


class BdmCatalogItemOut(OutputModel):
    identifier: str
    code: str
    name: str
    system: str | None
    history_available: bool | None
    table_type: str | None = None
    unit: str | None = None


class BdmCatalogOut(OutputModel):
    kind: BdmKind
    total: int
    page: int
    size: int
    system_filter_available: bool | None
    items: list[BdmCatalogItemOut]


class BdmSystemsOut(OutputModel):
    items: list[str]
    system_filter_available: bool
