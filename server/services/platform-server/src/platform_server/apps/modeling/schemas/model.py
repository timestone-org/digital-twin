"""模型版本与绑定的入参与出参。

⚠ 绑定那几个形状带 `Model` 前缀：**schema 类名在 openapi 里是全局的**，与大屏
的 `BindingOut` 重名会让 FastAPI 把**两边**都改成带全路径的长名，连累大屏那份
已经生成好的前端类型——而后端这边一个字都不会报。
"""

import uuid

from pydantic import Field

from platform_server.apps.dataset.services import FormulaDefOut
from platform_server.apps.modeling.protocols import (
    ModelTask,
    ServingChannel,
)
from platform_server.apps.modeling.schemas.common import (
    FormulaCode,
    InputModel,
    Label,
    Note,
    OutputModel,
    Utc,
)


class ModelVersionCreateIn(InputModel):
    """把一次成功运行发布成一个版本。"""

    run_id: uuid.UUID
    name: Label
    description: Note | None = None


class ModelVersionSummaryOut(OutputModel):
    """版本列表里的一条。"""

    id: uuid.UUID
    pipeline_id: uuid.UUID
    run_id: uuid.UUID
    version: int
    name: str
    algo: str
    task: ModelTask
    is_servable: bool
    serving_channel: ServingChannel
    unservable_reason: str | None
    feature_keys: list[str]
    target_key: str
    created_by_name: str | None
    created_at: Utc


class ModelVersionOut(ModelVersionSummaryOut):
    """版本详情，带指标、指纹与模型签名。"""

    #: 面向人与第三方的输入输出说明。⚠ 字段不叫 `schema`：那个名字会与
    #: `BaseModel.schema` 撞并当场告警，而本仓 CI 是零告警
    signature: dict[str, object] = Field(default_factory=dict[str, object])
    metrics: dict[str, float | None] = Field(
        default_factory=dict[str, float | None]
    )
    fingerprint: dict[str, object] = Field(default_factory=dict[str, object])
    description: str | None


class ModelBindingCreateIn(InputModel):
    """把一个版本绑到一条公式条目上。"""

    fx_code: str = Field(min_length=1, max_length=64)
    model_version_id: uuid.UUID


class ModelBindingUpdateIn(InputModel):
    """换版本或启停。两样都不给就是空操作。"""

    model_version_id: uuid.UUID | None = None
    is_enabled: bool | None = None
    #: 新版本的输入列与当初对上的不一样时，要显式确认过才换。
    #: ⚠ 不自动按名字重映射：两个版本恰好都有两个入口列、名字不同时，
    #: 自动映射会把甲的值喂给乙，而结果看着完全正常（D18）
    is_remap_confirmed: bool = False


class ParamMapOut(OutputModel):
    """一个形参落到哪个特征列上。"""

    param: str
    feature: str


class ModelBindingUsageOut(OutputModel):
    """一条受影响的台账列。"""

    table_code: str
    column_key: str


class ModelBindingOut(OutputModel):
    """一条绑定。

    ⚠ `orphaned` 是**每次列表时现算**的：公式条目可能被删掉，而绑定是逻辑引用
    拦不住。不做后台对账任务——那与「发现对不上就从上游重拉」是同一类错。
    """

    id: uuid.UUID
    fx_code: str
    model_version_id: uuid.UUID
    param_map: list[ParamMapOut]
    is_enabled: bool
    is_orphaned: bool
    created_by_name: str | None
    created_at: Utc
    updated_at: Utc


class ModelBindingImpactOut(ModelBindingOut):
    """换绑的回执：连同「哪些台账列会跟着变」。

    ⚠ 回执必须带影响面，但**重算不在这里做**：批量重算是 `dataset:backfill`
    档位的权限，不该被 `modeling:publish` 顺带授予（§7.7）。
    """

    usages: list[ModelBindingUsageOut] = Field(
        default_factory=list[ModelBindingUsageOut]
    )


class ModelFormulaRegisterIn(InputModel):
    """一键注册为公式。"""

    #: 公式库里的标识，也是调用点上写的那个字面量。⚠ 已存在时不覆盖，409
    fx_code: FormulaCode


class ModelFormulaOut(OutputModel):
    """一键注册的回执：新建的条目与新建的绑定。

    ⚠ 两样一起回：用户接下来要做的是「去台账把这条公式用上」，而那一步要的是
    条目的形参名；只回一个的话他还得再查一次。
    """

    formula: FormulaDefOut
    binding: ModelBindingOut
