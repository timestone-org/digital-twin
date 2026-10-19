"""设备异常检测的严格入参与显式逐行判定。"""

from typing import Annotated

from pydantic import Field, StrictInt

from platform_server.apps.modeling.schemas.common import InputModel, OutputModel
from platform_server.apps.modeling.schemas.deployment import (
    OpenModelInfoOut,
    OpenModelWarningOut,
)

MAX_DETECT_ROWS = 256
type FiniteSensor = Annotated[float, Field(strict=True, allow_inf_nan=False)]
type DetectionRow = dict[str, FiniteSensor | StrictInt | str | None]


class OpenModelDetectIn(InputModel):
    """实时数据按行输入，布尔值不作为数值接受。"""

    rows: list[DetectionRow] = Field(min_length=1, max_length=MAX_DETECT_ROWS)


class AnomalyDecisionOut(OutputModel):
    """异常分数大于阈值才判异常，分数不是概率。"""

    row: int
    is_anomaly: bool
    score: float
    threshold: float


class OpenModelDetectOut(OutputModel):
    """模型版本、逐行判定与输入区间告警。"""

    model: OpenModelInfoOut
    results: list[AnomalyDecisionOut]
    warnings: list[OpenModelWarningOut]
