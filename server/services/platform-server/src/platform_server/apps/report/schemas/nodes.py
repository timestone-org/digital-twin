"""数据图表与表格节点的配置边界。"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from platform_server.apps.report.schemas.common import Aggregation


class SeriesSpec(BaseModel):
    """图表序列引用。"""

    model_config = ConfigDict(extra="ignore")
    table: str = Field(min_length=1, max_length=64)
    key: str = Field(min_length=1, max_length=64)
    name: str = Field(default="", max_length=128)
    offset: int = Field(default=0, ge=-120, le=120)


class DataNodeSpec(BaseModel):
    """表格和图表的共享窗口及展示配置。"""

    model_config = ConfigDict(extra="ignore")
    table: str = Field(default="", max_length=64)
    keys: list[str] = Field(default_factory=list[str], max_length=100)
    series: list[SeriesSpec] = Field(
        default_factory=list[SeriesSpec], max_length=20
    )
    title: str = Field(default="", max_length=256)
    kind: Literal["line", "bar"] = "line"
    window: str | None = Field(default=None, max_length=16)
    offset: int = Field(default=0, ge=-120, le=120)
    anchor: Literal["period", "latest"] = "period"
    bucket: Literal["none", "hour", "day", "month"] = "none"
    agg: Aggregation = "avg"
    order: Literal["asc", "desc"] = "asc"
    time_format: Literal["auto", "datetime", "date", "time", "month"] = "auto"
    decimals: int = Field(default=2, ge=0, le=12)
    limit: int = Field(default=100, ge=1, le=1000)
    summary: Literal["none", "avg", "sum", "min", "max", "count"] = "none"
    render: Literal["native", "raster"] = "native"
