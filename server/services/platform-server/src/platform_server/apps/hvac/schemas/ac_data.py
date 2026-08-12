"""数据集目录、数据源绑定与达标范围的入参与出参。"""

from pydantic import Field

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
