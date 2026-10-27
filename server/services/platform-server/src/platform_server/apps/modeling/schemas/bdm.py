"""BDM 外部响应边界与平台目录出参。"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from platform_server.apps.modeling.schemas.common import OutputModel

type BdmKind = Literal["point", "raw", "formula"]


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
    kind: BdmKind
    series: list[BdmSeries] = Field(min_length=1, max_length=10)


class BdmCatalogWire(BaseModel):
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(alias="pageSize", ge=1, le=200)
    system_filter_available: bool | None = Field(
        default=None, alias="systemFilterAvailable"
    )
    items: list[dict[str, JsonValue]] = Field(max_length=200)


class BdmCatalogQuery(BaseModel):
    kind: BdmKind = "point"
    page: int = Field(default=1, ge=1, le=100_000)
    size: int = Field(default=50, ge=1, le=200)
    keyword: str = Field(default="", max_length=100)
    system: str = Field(default="", max_length=100)
    code: str = Field(default="", max_length=200)


class BdmCatalogItemOut(OutputModel):
    identifier: str
    code: str
    name: str
    system: str | None
    history_available: bool | None


class BdmCatalogOut(OutputModel):
    kind: BdmKind
    total: int
    page: int
    size: int
    system_filter_available: bool | None
    items: list[BdmCatalogItemOut]
