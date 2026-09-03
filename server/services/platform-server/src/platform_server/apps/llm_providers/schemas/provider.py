"""模型供应商面的入参与出参。ORM 模型绝不直接返给 HTTP 层。

⚠ 密钥**一个字都不出这道门**：出参里只有尾巴几位。把 api_key 交给浏览器等于
把整套部署的额度交出去，而它此后会躺在每一个人的 devtools 里。
"""

import uuid
from typing import Annotated, Any

from pydantic import (
    AfterValidator,
    Field,
    SecretStr,
    WithJsonSchema,
    model_validator,
)

from platform_server.apps.llm_providers.enums import (
    MODEL_KIND_EMBEDDING,
    MODEL_KINDS,
    PROVIDER_KIND_CODES,
    PROVIDER_KIND_OPENAI_COMPAT,
    provider_kind_of,
)
from platform_server.apps.llm_providers.rules import shape_mismatch
from platform_server.apps.llm_providers.schemas.common import (
    BaseUrl,
    InputModel,
    ModelName,
    Notes,
    OutputModel,
    ProviderName,
    Utc,
)

# 一路供应商最多登记几个模型。⚠ 有上限：清单是要摊进内部目录、每次刷新
# 都下发的，几百个模型的清单会让每次刷新都拖着一大段没人用的东西
MAX_MODELS_PER_PROVIDER = 64


def _known_kind(value: str) -> str:
    """未登记的模型种类一律拒。

    Args: value。
    """
    if value not in MODEL_KINDS:
        raise ValueError(f"未登记的模型种类：{value}")
    return value


# ⚠ `WithJsonSchema` 里必须摊出取值：闭合集合只写在校验器里的话，openapi 里
# 它就是裸 `string`，前端由它生成的类型于是允许任意字符串
ModelKind = Annotated[
    str,
    AfterValidator(_known_kind),
    WithJsonSchema({"type": "string", "enum": list(MODEL_KINDS)}),
]


def _known_provider_kind(value: str) -> str:
    """未登记的接入形态一律拒。

    Args: value。
    """
    if value not in PROVIDER_KIND_CODES:
        raise ValueError(f"未登记的供应商形态：{value}")
    return value


ProviderKind = Annotated[
    str,
    AfterValidator(_known_provider_kind),
    WithJsonSchema({"type": "string", "enum": list(PROVIDER_KIND_CODES)}),
]


class LlmModelIn(InputModel):
    """一路供应商上登记的一个模型。"""

    name: ModelName
    kind: ModelKind
    has_vision: bool = False
    # 嵌入模型的向量维数。⚠ 落库前拿它核对端点回来的长度：换了模型而维数
    # 变了的话，旧条目与新条目算不出有意义的余弦
    dimensions: int | None = Field(default=None, gt=0, le=65_536)

    @model_validator(mode="after")
    def _embedding_needs_dimensions(self) -> "LlmModelIn":
        """嵌入模型必须带维数，对话模型不许带。"""
        if self.kind == MODEL_KIND_EMBEDDING and self.dimensions is None:
            raise ValueError("嵌入模型必须填向量维数")
        if self.kind != MODEL_KIND_EMBEDDING and self.dimensions is not None:
            raise ValueError("只有嵌入模型才有向量维数")
        return self


def _unique_names(models: list[LlmModelIn]) -> list[LlmModelIn]:
    """同一路上的模型名不许重复：重复了分配时不知道指的是哪一个。

    Args: models。
    """
    names = [one.name for one in models]
    if len(names) != len(set(names)):
        raise ValueError("模型名在同一路供应商上不许重复")
    return models


Models = Annotated[
    list[LlmModelIn],
    Field(max_length=MAX_MODELS_PER_PROVIDER),
    AfterValidator(_unique_names),
]
# 透传给端点的额外请求体，一段 JSON 对象
ExtraBody = dict[str, Any] | None
# 这一形态自己的那几格配置。⚠ 认得的键由形态说了算，见 `rules.options_mismatch`
ProviderOptions = dict[str, Any] | None


class LlmProviderIn(InputModel):
    """新建一路供应商。要配哪几格由 `kind` 说了算。"""

    name: ProviderName
    # ⚠ 缺省是端点那一形态：这一格是后加的，不带它的客户端建的正是那一种
    kind: ProviderKind = PROVIDER_KIND_OPENAI_COMPAT
    # ⚠ 只有端点那一形态填这两格；靠登录的那些形态带了就拒，
    # 而不是存下来当没看见
    base_url: BaseUrl | None = None
    api_key: SecretStr | None = Field(
        default=None, min_length=1, max_length=512
    )
    is_enabled: bool = True
    extra_body: ExtraBody = None
    options: ProviderOptions = None
    models: Models = Field(default_factory=list[LlmModelIn])
    notes: Notes = ""

    @model_validator(mode="after")
    def _fields_match_the_kind(self) -> "LlmProviderIn":
        """配的那几格与形态对不对得上。"""
        spec = provider_kind_of(self.kind)
        # pragma 理由：形态码在上面那个校验器里已经拦过一遍
        if spec is None:  # pragma: no cover
            raise ValueError("未登记的供应商形态")
        rejected = shape_mismatch(
            spec,
            has_base_url=self.base_url is not None,
            has_api_key=self.api_key is not None,
            model_kinds=[one.kind for one in self.models],
            options=self.options,
        )
        if rejected is not None:
            raise ValueError(rejected)
        return self


class LlmProviderUpdateIn(InputModel):
    """改一路供应商。缺省的字段不动；`api_key` 不给即沿用旧的。

    ⚠ 没有 `kind`：改形态等于换一路接法，密钥、登录态与模型清单全部作废——
    那是「删了重建」，不是「改一格」。
    """

    name: ProviderName | None = None
    base_url: BaseUrl | None = None
    api_key: SecretStr | None = Field(
        default=None, min_length=1, max_length=512
    )
    is_enabled: bool | None = None
    # ⚠ 与「不动」分开：要清空方言体就传 `null`，而缺省是「不动」
    extra_body: ExtraBody | None = None
    options: ProviderOptions | None = None
    models: Models | None = None
    notes: Notes | None = None


class LlmProviderPresetOut(OutputModel):
    """建一路时能一键填上的一套取值。"""

    code: str
    label: str
    base_url: str


class LlmRerankDialectOut(OutputModel):
    """一套重排线形。重排不在 OpenAI 兼容口径里，各家的路径与请求体不同。"""

    code: str
    label: str
    description: str


class LlmProviderKindOut(OutputModel):
    """一种接入形态：界面按它决定摆哪几格、后端按它校验。

    ⚠ 由后端下发而不是前端写死：两份漂开的表现是「表单里填了、保存时 422」，
    而报出来的那句话指不回是哪一格多余。
    """

    code: str
    label: str
    description: str
    is_endpoint_required: bool
    is_login_required: bool
    model_kinds: list[str]
    consumers: list[str]
    efforts: list[str]
    # 这一形态配得出哪几套重排线形；空表示它登记不了重排模型。
    # ⚠ 第一个是默认那一路：没配这一格的供应商按它解
    rerank_dialects: list[LlmRerankDialectOut]
    presets: list[LlmProviderPresetOut]


class LlmProbeIn(InputModel):
    """保存前先探一次端点通不通。"""

    base_url: BaseUrl
    api_key: SecretStr = Field(min_length=1, max_length=512)


class LlmModelOut(OutputModel):
    """一路供应商上登记的一个模型。"""

    name: str
    kind: str
    has_vision: bool
    dimensions: int | None


class LlmProviderOut(OutputModel):
    """一路供应商。密钥只露尾巴。"""

    id: uuid.UUID
    name: str
    kind: str
    # 靠登录的那些形态没有端点，这一格是空串
    base_url: str
    # 密钥尾巴几位，形如 `…a1b2`。只回答「填的是不是那一把」
    api_key_hint: str
    is_enabled: bool
    extra_body: dict[str, Any] | None
    options: dict[str, Any] | None
    models: list[LlmModelOut]
    notes: str
    # 此刻指着这一路的用途码；删之前界面要把它们摆出来
    assigned_purposes: list[str] = Field(default_factory=list[str])
    updated_by: str | None
    created_at: Utc
    updated_at: Utc


class LlmProbeOut(OutputModel):
    """探一次端点的结果。"""

    is_ok: bool
    # 给人看的一句话；失败时是原因，不含端点地址与密钥
    message: str
    # 端点自报的模型代号，界面拿它做「一键登记」
    model_names: list[str] = Field(default_factory=list[str])


class LlmAssignmentIn(InputModel):
    """把一个用途指到一路供应商上的一个模型。"""

    provider_id: uuid.UUID
    model_name: ModelName


class LlmPurposeOut(OutputModel):
    """一个用途，以及它此刻指向哪里。没分配时后四格都是 null。"""

    purpose: str
    label: str
    description: str
    kind: str
    consumer: str
    is_vision_required: bool
    # 没分配时那一侧还有没有环境变量那一档兜底。⚠ 为假即「不分配就是不启用」
    has_env_default: bool
    provider_id: uuid.UUID | None
    provider_name: str | None
    model_name: str | None
    updated_at: Utc | None
