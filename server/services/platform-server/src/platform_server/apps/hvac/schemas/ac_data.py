"""数据集目录、数据源绑定、达标范围与原始数据的入参与出参。"""

from dataclasses import dataclass
from datetime import datetime

from pydantic import Field, PositiveInt

from platform_server.apps.hvac.models.ac_data_binding import (
    MAX_SOURCE_OBJECT_LENGTH,
)
from platform_server.apps.hvac.schemas.common import (
    ExactDecimal,
    InputModel,
    OutputModel,
    Utc,
)

# 一台空调的达标范围条目数上限，与可配指标数同量级：批量入参无上限即一次 OOM
MAX_METRIC_LIMITS = 64
# 折线图的点数区间。下限保证图有形状，上限保证一次响应不会大到拖垮浏览器
MIN_SERIES_POINTS = 100
MAX_SERIES_POINTS = 2000
DEFAULT_SERIES_POINTS = 1000


@dataclass(frozen=True)
class TimeWindow:
    """一次取数的时间区间，左闭右开。两端都是 UTC aware。"""

    start: datetime
    end: datetime


@dataclass(frozen=True)
class SeriesOptions:
    """聚合序列的取数选项。

    `metrics` 是逗号分隔的原始串，白名单校验在 service 层做——api 层不写业务。
    """

    metrics: str
    max_points: int


class MetricOut(OutputModel):
    """目录里的一个指标。前端的指标选择器与 Y 轴分组都读它。"""

    key: str
    name: str
    unit: str
    group: str
    is_limitable: bool
    is_charted_by_default: bool


class DatasetOut(OutputModel):
    """目录里的一个数据集。"""

    key: str
    name: str
    description: str
    metrics: list[MetricOut]


class SourceObjectOut(OutputModel):
    """外部库里一个可绑定的对象。`caption` 取不到时给 null。"""

    name: str
    caption: str | None
    row_count_hint: int | None


class AcDataBindingOut(OutputModel):
    """一条数据源绑定。"""

    dataset: str
    source_object: str
    created_at: Utc
    updated_at: Utc


class AcDataBindingPutIn(InputModel):
    """设置绑定。数据集在路径上，故这里只有对象名。"""

    source_object: str = Field(
        min_length=1, max_length=MAX_SOURCE_OBJECT_LENGTH
    )


class MetricLimitIn(InputModel):
    """一个指标的达标范围。两端都省略等同于不配置该指标。"""

    metric: str
    lower_limit: ExactDecimal | None = None
    upper_limit: ExactDecimal | None = None


class MetricLimitOut(OutputModel):
    """一个指标的达标范围。单边为 null 表示该侧不限制。"""

    metric: str
    lower_limit: ExactDecimal | None
    upper_limit: ExactDecimal | None


class MetricLimitsPutIn(InputModel):
    """覆盖式设置一台空调的全部达标范围。

    ⚠ 覆盖式：请求里没出现的指标视为清除。这与 PATCH 的「没给就是不改」相反，
    用 PUT 正是为了把这个语义摆在方法上。
    """

    items: list[MetricLimitIn] = Field(max_length=MAX_METRIC_LIMITS)


class MetricLimitsOut(OutputModel):
    """一台空调的全部达标范围。"""

    items: list[MetricLimitOut]


class DatasetsOut(OutputModel):
    """数据集目录。"""

    items: list[DatasetOut]


class SourceObjectsOut(OutputModel):
    """可绑定对象清单。"""

    items: list[SourceObjectOut]


class AcDataBindingsOut(OutputModel):
    """一台空调的全部绑定。"""

    items: list[AcDataBindingOut]


class RawSampleOut(OutputModel):
    """原始数据表格里的一行：一个时刻上的 19 个测点原值。

    ⚠ 测点值走 JSON number 而非字符串（api-contract §6：传感器精度本身低于
    float64），且 `null` 一律保持 `null`——把它折成 0 会让数据断档被读成一次
    真实的停机。字段名必须与目录逐一对应，由契约测试锁死。
    """

    ts: Utc
    workshop_temp_avg: float | None
    workshop_humidity_avg: float | None
    ac_temp_setpoint: float | None
    ac_humidity_setpoint: float | None
    fresh_air_temp: float | None
    fresh_air_humidity: float | None
    supply_air_temp: float | None
    supply_air_humidity: float | None
    return_air_temp: float | None
    return_air_humidity: float | None
    mixed_air_temp: float | None
    mixed_air_humidity: float | None
    chilled_water_supply_temp: float | None
    chilled_water_supply_pressure: float | None
    heat_steam_temp: float | None
    heat_steam_pressure: float | None
    humidify_steam_temp: float | None
    humidify_steam_pressure: float | None
    fan_frequency: float | None


class SeriesPointOut(OutputModel):
    """聚合序列上的一个桶。整桶全空的指标给 null，不给 0。"""

    ts: Utc
    values: dict[str, float | None]


class RawSeriesOut(OutputModel):
    """聚合序列。

    ⚠ `interval_minutes` 必须回显（api-contract §6.1）：桶宽是服务端按点数上限
    挑的，不回显的话前端画出来的疏密无从解释。
    """

    # 桶宽恒为正：0 分钟的桶没有意义，而 PositiveInt 让这条进 openapi
    interval_minutes: PositiveInt
    metrics: list[str]
    points: list[SeriesPointOut]
