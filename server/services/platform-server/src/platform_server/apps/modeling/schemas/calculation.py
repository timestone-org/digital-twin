"""规则计算的严格输入与结构化逐行结果。"""

from pydantic import Field, JsonValue

from platform_server.apps.modeling.schemas.common import InputModel, OutputModel
from platform_server.apps.modeling.schemas.deployment import OpenModelInfoOut
from platform_server.apps.modeling.schemas.detection import DetectionRow

MAX_CALCULATE_ROWS = 256


class OpenModelCalculateIn(InputModel):
    """输入按模型签名校验，缺失值不能作为正常值计算。"""

    rows: list[DetectionRow] = Field(
        min_length=1,
        max_length=MAX_CALCULATE_ROWS,
        description="按模型列输入；精确计量值使用十进制字符串，保留原值精度",
    )


class OpenModelCalculateOut(OutputModel):
    """规则结果保留分类明细、能源路径与诊断命中条件。"""

    model: OpenModelInfoOut
    results: list[dict[str, JsonValue]]
