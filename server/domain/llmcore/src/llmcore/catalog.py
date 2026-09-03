"""模型目录：平台上配好的那几路供应商，以及「哪个用途走哪一路模型」。

目录由平台持有、经内部接口下发，两个消费方（对话面与知识库）各自按用途
解出端点（ADR-0039）。这一层**只认形状与解析**，不认任何用途名——用途是
消费方自己的字面量，这里把它当成不透明的字符串。

⚠ 解不出端点时给 `None` 而不是抛：消费方据此回落到自己环境变量里的那一档
（config-and-secrets §7.1：环境变量是永久默认值），而「配了却没生效」
要靠平台侧在写入时把用途、模型与种类校验对齐，不靠这里猜。

⚠ 密钥装在 `SecretStr` 里，从形状上就不许它被 print 或写进日志。
"""

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError

from llmcore.endpoints import ChatEndpoint, EmbeddingEndpoint, RerankEndpoint

# 一路模型的种类。⚠ 闭合集合：嵌入模型与对话模型不通用，拿对话模型名去打
# embeddings 端点是一条必然失败的调用，按种类分开才拦得住这一档错配
MODEL_KIND_CHAT = "chat"
MODEL_KIND_EMBEDDING = "embedding"
MODEL_KIND_RERANK = "rerank"
MODEL_SPEC_KINDS: tuple[str, ...] = (
    MODEL_KIND_CHAT,
    MODEL_KIND_EMBEDDING,
    MODEL_KIND_RERANK,
)

# 重排线形落在供应商的这一格配置上。⚠ 跟着**端点**走而不是跟着模型走：
# 方言说的是「打哪个路径、什么请求体」，同一路端点上的每个重排模型都一样。
# 挂在模型上的话，同一路上配两个模型就能配出两套互相矛盾的线形
OPTION_RERANK_DIALECT = "rerank_dialect"

# 一路供应商的**接入形态**。⚠ 这一层只认协议不认厂商：`openai_compat` 说的是
# 「按 OpenAI 兼容口径打一个 HTTP 端点」，谁家的端点都算；`codex_oauth` 说的是
# 「先走一次设备码登录，再拿令牌打订阅账号那条私有面」。解端点的那几条方法只
# 认前者——后者没有端点与密钥，放行的话一个空地址会被当成端点打出去。
# ⚠ 两个码都是**跨服务契约**：与 platform-server 的 `enums.py` 逐字一致，由前端
# 的 `llm-shapes.contract.spec.ts` 对着几份源码比。漂开的表现是「界面上配好了
# 一路、消费方却当它不存在」，而两边代码单看都对
PROVIDER_KIND_OPENAI_COMPAT = "openai_compat"
PROVIDER_KIND_CODEX_OAUTH = "codex_oauth"


class CatalogMalformed(ValueError):
    """内部接口回来的目录不成形。"""


@dataclass(frozen=True)
class ModelSpec:
    """一路供应商上登记的一个模型。"""

    name: str
    kind: str
    has_vision: bool = False
    # 嵌入模型的向量维数；对话模型没有这一格
    dimensions: int | None = None


@dataclass(frozen=True)
class ProviderSpec:
    """一路供应商：一种接入形态 + 它上面登记的几个模型。

    ⚠ `openai_compat` 之外的形态**没有端点与密钥**（那一路的登录态在消费方
    那一侧），`base_url` 与 `api_key` 于是是空的。解端点的几条方法据 `kind`
    拦住它们——放行的话，一个空地址会被当成端点打出去，而报出来的是一条
    连不上的网络错，与「这一路根本不是这么接的」完全对不上。
    """

    id: str
    name: str
    # 接入形态。⚠ 认不出的形态一律当成「这一层接不了」，不猜
    kind: str
    base_url: str
    api_key: SecretStr
    is_enabled: bool
    models: tuple[ModelSpec, ...]
    # 端点方言里的额外请求体（思考开关一类），随目录一起下发
    extra_body: dict[str, Any] | None = None
    # 这一形态自己的那几格配置（推理档位一类）。⚠ 形状由平台侧按形态校验，
    # 这一层只透传：认了它的取值就等于在这里认厂商
    options: dict[str, Any] | None = None

    @property
    def is_endpoint_based(self) -> bool:
        """这一路打得出一个 OpenAI 兼容端点吗。"""
        return self.kind == PROVIDER_KIND_OPENAI_COMPAT

    def model_named(self, name: str) -> ModelSpec | None:
        """按名字取登记的那一个模型；没有给 `None`。

        Args: name。
        """
        return next((one for one in self.models if one.name == name), None)

    def models_of(self, kind: str) -> tuple[ModelSpec, ...]:
        """这一路上属于某一种的那几个模型，保持登记序。

        Args: kind（`MODEL_SPEC_KINDS` 里的一个）。
        """
        return tuple(one for one in self.models if one.kind == kind)

    @property
    def rerank_dialect(self) -> str:
        """这一路的重排线形码；没配是空串，由方言注册表按默认那一路解。

        ⚠ 防着读：`options` 是一段透传的 JSON，塞进来一个数字也存得下，
        而那时拿它去挑方言是一条 `TypeError`，位置离配置面很远。
        """
        found = (self.options or {}).get(OPTION_RERANK_DIALECT)
        return found if isinstance(found, str) else ""


@dataclass(frozen=True)
class Assignment:
    """一个用途此刻走哪一路的哪个模型。"""

    purpose: str
    provider_id: str
    model_name: str


@dataclass(frozen=True)
class Resolved:
    """一个用途解出来的那一路与那个模型。"""

    provider: ProviderSpec
    model: ModelSpec


@dataclass(frozen=True)
class ModelCatalog:
    """一份完整目录。`version` 是平台算的内容摘要，变了才值得重新装配。"""

    providers: tuple[ProviderSpec, ...]
    assignments: tuple[Assignment, ...]
    version: str = ""

    @property
    def is_empty(self) -> bool:
        """一路供应商都没配。"""
        return not self.providers

    def provider(self, provider_id: str) -> ProviderSpec | None:
        """按 id 取一路供应商，停用的也给——「配了但停着」与「没这一路」是
        两回事，消费方要能分别如实说。

        Args: provider_id。
        """
        return next(
            (one for one in self.providers if one.id == provider_id), None
        )

    def enabled_providers(self) -> tuple[ProviderSpec, ...]:
        """此刻开着的那几路，保持目录序。消费方按它逐路装适配器。"""
        return tuple(one for one in self.providers if one.is_enabled)

    def assigned(self, purpose: str) -> Assignment | None:
        """这个用途此刻的分配行；没配给 `None`。

        ⚠ 与 `resolve` 分开：分配指着一路已停用的供应商时 `resolve` 给 `None`，
        而「分配指的是谁」这一问在那时仍然有答案，界面与日志都要它。

        Args: purpose。
        """
        return next(
            (one for one in self.assignments if one.purpose == purpose), None
        )

    def resolve(self, purpose: str) -> Resolved | None:
        """这个用途此刻落在哪一路的哪个模型上；没配、或那一路停用了，给 `None`。

        Args: purpose。
        """
        assigned = self.assigned(purpose)
        if assigned is None:
            return None
        provider = self.provider(assigned.provider_id)
        if provider is None or not provider.is_enabled:
            return None
        model = provider.model_named(assigned.model_name)
        if model is None:
            return None
        return Resolved(provider=provider, model=model)

    def endpoint_on(
        self, provider: ProviderSpec, model: ModelSpec, *, timeout_s: float
    ) -> ChatEndpoint | None:
        """在指定的一路上按指定的模型打一个对话端点。

        ⚠ 形态不是 OpenAI 兼容、或那不是个对话模型时给 `None`：这两条都不是
        「暂时不可用」，而是「这一路不该这么打」。

        Args: provider, model, timeout_s（消费方自己的调用预算）。
        """
        if not provider.is_endpoint_based or model.kind != MODEL_KIND_CHAT:
            return None
        return ChatEndpoint(
            base_url=provider.base_url,
            api_key=provider.api_key,
            model=model.name,
            timeout_s=timeout_s,
            extra_body=provider.extra_body,
        )

    def chat_endpoint(
        self, purpose: str, *, timeout_s: float
    ) -> ChatEndpoint | None:
        """这个用途要打的对话端点。种类不是对话模型、或那一路不是
        OpenAI 兼容形态时给 `None`。

        Args: purpose, timeout_s（消费方自己的调用预算）。
        """
        found = self.resolve(purpose)
        if found is None:
            return None
        return self.endpoint_on(
            found.provider, found.model, timeout_s=timeout_s
        )

    def embedding_endpoint(
        self, purpose: str, *, timeout_s: float
    ) -> EmbeddingEndpoint | None:
        """这个用途要打的嵌入端点。种类不是嵌入模型、或没登记维数时给 `None`。

        Args: purpose, timeout_s。
        """
        found = self.resolve(purpose)
        if found is None or found.model.kind != MODEL_KIND_EMBEDDING:
            return None
        # ⚠ 形态闸：不是 OpenAI 兼容的那些路没有端点与密钥，下发空地址等于
        # 让每一次嵌入都撞一条连不上的网络错
        if not found.provider.is_endpoint_based:
            return None
        if found.model.dimensions is None:
            return None
        return EmbeddingEndpoint(
            base_url=found.provider.base_url,
            api_key=found.provider.api_key,
            model=found.model.name,
            timeout_s=timeout_s,
            dimensions=found.model.dimensions,
        )

    def rerank_endpoint(
        self, purpose: str, *, timeout_s: float
    ) -> RerankEndpoint | None:
        """这个用途要打的重排端点。种类不是重排模型时给 `None`。

        ⚠ 没有维数那一格要核对：重排只排序、什么都不落库，故换一路重排模型
        不作废任何存量向量——界面上别把它说成「换了要重建」。

        Args: purpose, timeout_s。
        """
        found = self.resolve(purpose)
        if found is None or found.model.kind != MODEL_KIND_RERANK:
            return None
        # ⚠ 形态闸：不是 OpenAI 兼容的那些路没有端点与密钥，下发空地址等于
        # 让每一次重排都撞一条连不上的网络错
        if not found.provider.is_endpoint_based:
            return None
        return RerankEndpoint(
            base_url=found.provider.base_url,
            api_key=found.provider.api_key,
            model=found.model.name,
            timeout_s=timeout_s,
            dialect=found.provider.rerank_dialect,
        )

    @classmethod
    def from_wire(cls, body: object) -> "ModelCatalog":
        """把内部接口回来的 JSON 解成目录；不成形抛 `CatalogMalformed`。

        Args: body。
        """
        try:
            wire = _CatalogWire.model_validate(body)
        except ValidationError as error:
            raise CatalogMalformed("模型目录不成形") from error
        return cls(
            providers=tuple(_provider_of(one) for one in wire.providers),
            assignments=tuple(
                Assignment(
                    purpose=one.purpose,
                    provider_id=one.provider_id,
                    model_name=one.model_name,
                )
                for one in wire.assignments
            ),
            version=wire.version,
        )


EMPTY_CATALOG = ModelCatalog(providers=(), assignments=())


def catalog_version(
    providers: tuple[ProviderSpec, ...], assignments: tuple[Assignment, ...]
) -> str:
    """一份目录的内容摘要：两侧算出来的要一样，才能拿它判「变没变」。

    ⚠ 密钥**不进摘要**：摘要会进日志与响应，而它只该回答「配置变没变」。
    换密钥不换模型名时目录照样重拉——消费方按 TTL 拉，不靠这一格省那一次。

    Args: providers, assignments。
    """
    body = {
        "providers": [
            {
                "id": one.id,
                "name": one.name,
                "kind": one.kind,
                "base_url": one.base_url,
                "is_enabled": one.is_enabled,
                "extra_body": one.extra_body,
                "options": one.options,
                "models": [
                    {
                        "name": model.name,
                        "kind": model.kind,
                        "has_vision": model.has_vision,
                        "dimensions": model.dimensions,
                    }
                    for model in one.models
                ],
            }
            for one in providers
        ],
        "assignments": [
            {
                "purpose": one.purpose,
                "provider_id": one.provider_id,
                "model_name": one.model_name,
            }
            for one in assignments
        ],
    }
    compact = json.dumps(body, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(compact.encode("utf-8")).hexdigest()[:16]


class _ModelWire(BaseModel):
    """线上一个模型的形状。"""

    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    has_vision: bool = False
    dimensions: int | None = None


class _ProviderWire(BaseModel):
    """线上一路供应商的形状。"""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    # ⚠ 缺省当成 OpenAI 兼容：平台比消费方先升级不是必然的，而一份没有这一格
    # 的旧目录里每一路本来就都是这一形态
    kind: str = PROVIDER_KIND_OPENAI_COMPAT
    # ⚠ 只有 OpenAI 兼容那一形态才有这两格，别的形态是空串
    base_url: str = ""
    api_key: str = ""
    is_enabled: bool = True
    extra_body: dict[str, Any] | None = None
    options: dict[str, Any] | None = None
    models: list[_ModelWire] = Field(default_factory=list[_ModelWire])


class _AssignmentWire(BaseModel):
    """线上一条用途分配的形状。"""

    model_config = ConfigDict(extra="ignore")

    purpose: str = Field(min_length=1)
    provider_id: str = Field(min_length=1)
    model_name: str = Field(min_length=1)


class _CatalogWire(BaseModel):
    """内部接口的 `data` 段。"""

    model_config = ConfigDict(extra="ignore")

    version: str = ""
    providers: list[_ProviderWire] = Field(default_factory=list[_ProviderWire])
    assignments: list[_AssignmentWire] = Field(
        default_factory=list[_AssignmentWire]
    )


def _provider_of(wire: _ProviderWire) -> ProviderSpec:
    return ProviderSpec(
        id=wire.id,
        name=wire.name,
        kind=wire.kind,
        base_url=wire.base_url,
        api_key=SecretStr(wire.api_key),
        is_enabled=wire.is_enabled,
        extra_body=wire.extra_body,
        options=wire.options,
        models=tuple(
            ModelSpec(
                name=one.name,
                kind=one.kind,
                has_vision=one.has_vision,
                dimensions=one.dimensions,
            )
            for one in wire.models
        ),
    )
