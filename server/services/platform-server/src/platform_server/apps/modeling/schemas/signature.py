"""已部署模型的公开输入输出说明；见 MODELING_THIRD_PARTY_API.md。"""

from typing import Literal

from pydantic import ConfigDict, Field

from platform_server.apps.modeling.protocols import ModelTask
from platform_server.apps.modeling.schemas.common import OutputModel


class OpenModelMissingPolicyOut(OutputModel):
    """冻结推理格式声明的缺值处理策略。"""

    on_missing: Literal["reject", "fitted_default"]
    on_null: Literal["return_null", "fitted_default"]


class OpenModelInputOut(OutputModel):
    """调用方在每行 rows 对象中提供的一个字段。"""

    model_config = ConfigDict(extra="allow")

    key: str = Field(description="请求行中的字段名，保持签名中的顺序")
    label: str = ""
    unit: str = ""
    dtype: str = Field(default="number", description="训练入口的类型元信息")
    is_required: bool = True
    default_on_missing: float | None = None
    missing_policy: OpenModelMissingPolicyOut | None = None


class OpenModelDerivedOut(OutputModel):
    """推理链生成的字段，不需要调用方提供。"""

    model_config = ConfigDict(extra="allow")

    key: str
    by: str = ""
    label: str = ""


class OpenModelOutputOut(OutputModel):
    """固定模型版本的输出说明。"""

    model_config = ConfigDict(extra="allow")

    task: ModelTask
    key: str = ""
    label: str = ""
    unit: str = ""
    dtype: str = ""


class OpenModelSignatureOut(OutputModel):
    """公开签名与推荐调用地址，不包含训练分布。"""

    model_config = ConfigDict(extra="allow")

    task: ModelTask
    invoke_url: str = Field(description="此任务的同源 POST 调用路径")
    timestamp_key: Literal["__ts__"] | None = Field(
        description="需要逐行时间时为 __ts__，否则为 null"
    )
    format_version: str | None = None
    is_timestamp_required: bool = Field(
        default=False, alias="requires_timestamp"
    )
    inputs: list[OpenModelInputOut]
    derived: list[OpenModelDerivedOut] = Field(
        default_factory=list[OpenModelDerivedOut]
    )
    output: OpenModelOutputOut
