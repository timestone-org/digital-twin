"""达标时长模型面的对外模型。口径见 docs/AC_MODEL_DESIGN.md §5。"""

import uuid

from pydantic import Field

from platform_server.apps.hvac.model_statuses import MIN_HALF_LIFE_DAYS
from platform_server.apps.hvac.schemas.common import (
    InputModel,
    Label,
    OutputModel,
    RoomRef,
    Utc,
    WorkshopRef,
)

# 半衰期上限（天）：十年等于不衰减，再大就是在骗自己配了衰减
_MAX_HALF_LIFE_DAYS = 3650.0


class MetricsBlockOut(OutputModel):
    """一组折外预测的评估。`coverage` 标称 80%，显著更低说明区间在撒谎。"""

    count: int
    mae: float
    medae: float
    rmse: float
    coverage: float
    mean_width: float
    # 按平均区间宽度分档：reliable / indicative / weak
    reliability: str


class ModelMetricsOut(OutputModel):
    """总体 + 按服务组合的评估。⚠ 没样本的组合是 null 不是零。"""

    overall: MetricsBlockOut
    by_set: dict[str, MetricsBlockOut | None]


class AcModelOut(OutputModel):
    """一个模型的完整对外形态。

    ⚠ `failed` 行上的 `metrics` 可能仍是上一次成功的产物（重训失败保留
    上一份），配着 `error` 一起读。
    """

    id: uuid.UUID
    name: str
    description: str | None
    room: RoomRef
    workshop: WorkshopRef
    serving_sets: list[list[str]]
    half_life_days: float
    status: str
    error: str | None
    feature_version: int | None
    trained_at: Utc | None
    sample_count: int | None
    window_start: Utc | None
    window_end: Utc | None
    metrics: ModelMetricsOut | None
    # ⚠ 数据已更新（当前批次指纹 ≠ 训练时的）或特征口径已更新时提示重训；
    # 训练产物本身仍然可用，这两个位只是提示不是失效
    is_batch_stale: bool
    is_feature_stale: bool
    created_by: str
    created_at: Utc
    updated_at: Utc


class AcModelCreateIn(InputModel):
    """建模入参。服务组合选的是服务面不是训练集（AC_MODEL_DESIGN §1）。"""

    room_id: uuid.UUID
    name: Label
    description: str | None = None
    serving_sets: list[list[str]] = Field(min_length=1)
    half_life_days: float = Field(
        default=180.0, ge=MIN_HALF_LIFE_DAYS, le=_MAX_HALF_LIFE_DAYS
    )


class AcModelPatchIn(InputModel):
    """改名、改描述或改服务组合。⚠ 改组合就地重汇总评估，不触发重训。"""

    name: Label | None = None
    description: str | None = None
    serving_sets: list[list[str]] | None = Field(default=None, min_length=1)


class ModelPredictionOut(OutputModel):
    """一条折外预测与实际的对比。"""

    started_at: Utc
    running_set: list[str]
    actual_minutes: int
    p10: float
    p50: float
    p90: float
    fold: int


class PredictReadingsIn(InputModel):
    """试算时一台机组的读数。⚠ 缺测就省略字段，不要填 0——0 是真实读数。"""

    workshop_temp_avg: float | None = None
    workshop_humidity_avg: float | None = None
    fresh_air_temp: float | None = None
    fresh_air_humidity: float | None = None
    chilled_water_supply_temp: float | None = None


class PredictIn(InputModel):
    """试算入参：一个假想的开机条件。

    `at` 省略即当下（决定时段与季节特征）；`idle_minutes` 省略按未知处理。
    """

    running_set: list[str] = Field(min_length=1)
    readings: dict[str, PredictReadingsIn] = Field(default_factory=dict)
    at: Utc | None = None
    idle_minutes: int | None = Field(default=None, ge=0)


class PredictOut(OutputModel):
    """试算结果：三分位达标时长与可靠性。

    ⚠ `is_in_serving_sets` 为假表示这是对服务组合之外的外推——不拒绝，
    但要说清楚。
    """

    p10: float
    p50: float
    p90: float
    interval_width_minutes: float
    reliability: str
    is_in_serving_sets: bool
    trained_at: Utc
