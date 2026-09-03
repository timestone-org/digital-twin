"""对外服务面的入参与出参：部署、API 密钥、调用量、预测。

⚠ 出参里**没有**明文密钥这一格，除了创建密钥那一次的回执
（docs/MODELING_PLATFORM_DESIGN.md D13）。
⚠ 预测的出参**只有预测值与告警**：不回列统计、不回训练区间的具体数值、不回
任何台账编码（D15 的防线 ⑩）。
"""

import uuid
from typing import Annotated

from pydantic import Field, StringConstraints

from platform_server.apps.modeling.models.deployment import (
    CODE_PATTERN,
    MAX_ROWS_CEILING,
)
from platform_server.apps.modeling.schemas.common import (
    InputModel,
    Label,
    Note,
    OutputModel,
    Utc,
)

# 对外标识：URL 段。⚠ 与库上的 CHECK 同一份口径
ModelDeploymentCode = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=2,
        max_length=63,
        pattern=CODE_PATTERN,
    ),
]

# 一次请求里的一行。键是入口列的 key，值是数或空；`__ts__` 是保留键，
# 带时间特征的模型靠它算出「小时」这类列
OpenModelRow = dict[str, float | int | str | None]


class ModelDeploymentCreateIn(InputModel):
    """开一个对外服务。"""

    code: ModelDeploymentCode
    model_version_id: uuid.UUID
    name: Label
    description: Note | None = None
    max_rows_per_call: int = Field(default=200, ge=1, le=MAX_ROWS_CEILING)
    rate_limit_per_minute: int = Field(default=60, ge=1, le=6000)


class ModelDeploymentUpdateIn(InputModel):
    """改一个对外服务。`code` 建后不可改——第三方的代码里写着它。"""

    name: Label | None = None
    description: Note | None = None
    model_version_id: uuid.UUID | None = None
    is_enabled: bool | None = None
    max_rows_per_call: int | None = Field(
        default=None, ge=1, le=MAX_ROWS_CEILING
    )
    rate_limit_per_minute: int | None = Field(default=None, ge=1, le=6000)


class ModelDeploymentOut(OutputModel):
    """一个对外服务。"""

    id: uuid.UUID
    code: str
    model_version_id: uuid.UUID
    #: 钉的那个版本的名字与版本号，免得界面再查一次
    model_name: str
    model_version: int
    name: str
    description: str | None
    is_enabled: bool
    #: 钉的版本能不能上线。⚠ 与 `is_enabled` 分两格：一个是人关的，
    #: 一个是模型本身不可服务，两者要给用户看不同的话
    is_servable: bool
    unservable_reason: str | None
    max_rows_per_call: int
    rate_limit_per_minute: int
    key_count: int
    created_by_name: str | None
    created_at: Utc
    updated_at: Utc


class ModelApiKeyCreateIn(InputModel):
    """铸一把新钥匙。"""

    name: Label
    #: 有效期。不给就是长期有效
    expires_at: Utc | None = None


class ModelApiKeyOut(OutputModel):
    """一把钥匙。⚠ 没有明文这一格。"""

    id: uuid.UUID
    deployment_id: uuid.UUID
    name: str
    key_prefix: str
    expires_at: Utc | None
    revoked_at: Utc | None
    last_used_at: Utc | None
    created_by_name: str | None
    created_at: Utc


class ModelApiKeyMintedOut(ModelApiKeyOut):
    """刚铸出来那一把，**只有这一次**带明文。"""

    #: ⚠ 明文只在这个回执里出现一次，之后任何接口都取不回来。界面上要说清楚
    plaintext: str


class ModelCallStatOut(OutputModel):
    """某一天的调用量。"""

    day: Utc
    total: int
    failed: int


class OpenModelPredictIn(InputModel):
    """一次对外预测请求。"""

    rows: list[OpenModelRow] = Field(min_length=1)


class OpenModelWarningOut(OutputModel):
    """一条告警。有告警不等于算不出来——外推照样给数，只是标注出来。"""

    row: int
    column: str
    kind: str
    message: str


class OpenModelInfoOut(OutputModel):
    """算这一次的是哪个模型。"""

    code: str
    version: int


class OpenModelPredictOut(OutputModel):
    """一次对外预测的结果。"""

    model: OpenModelInfoOut
    predictions: list[float | None]
    warnings: list[OpenModelWarningOut] = Field(
        default_factory=list[OpenModelWarningOut]
    )
