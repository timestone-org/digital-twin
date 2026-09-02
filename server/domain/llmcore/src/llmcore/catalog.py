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

from llmcore.endpoints import ChatEndpoint, EmbeddingEndpoint

# 一路模型的种类。⚠ 闭合集合：嵌入模型与对话模型不通用，拿对话模型名去打
# embeddings 端点是一条必然失败的调用，按种类分开才拦得住这一档错配
MODEL_KIND_CHAT = "chat"
MODEL_KIND_EMBEDDING = "embedding"
MODEL_SPEC_KINDS: tuple[str, ...] = (MODEL_KIND_CHAT, MODEL_KIND_EMBEDDING)


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
    """一路供应商：一个 OpenAI 兼容端点 + 它上面登记的几个模型。"""

    id: str
    name: str
    base_url: str
    api_key: SecretStr
    is_enabled: bool
    models: tuple[ModelSpec, ...]
    # 端点方言里的额外请求体（思考开关一类），随目录一起下发
    extra_body: dict[str, Any] | None = None

    def model_named(self, name: str) -> ModelSpec | None:
        """按名字取登记的那一个模型；没有给 `None`。

        Args: name。
        """
        return next((one for one in self.models if one.name == name), None)


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

    def resolve(self, purpose: str) -> Resolved | None:
        """这个用途此刻落在哪一路的哪个模型上；没配、或那一路停用了，给 `None`。

        Args: purpose。
        """
        assigned = next(
            (one for one in self.assignments if one.purpose == purpose), None
        )
        if assigned is None:
            return None
        provider = next(
            (one for one in self.providers if one.id == assigned.provider_id),
            None,
        )
        if provider is None or not provider.is_enabled:
            return None
        model = provider.model_named(assigned.model_name)
        if model is None:
            return None
        return Resolved(provider=provider, model=model)

    def chat_endpoint(
        self, purpose: str, *, timeout_s: float
    ) -> ChatEndpoint | None:
        """这个用途要打的对话端点。种类不是对话模型时给 `None`。

        Args: purpose, timeout_s（消费方自己的调用预算）。
        """
        found = self.resolve(purpose)
        if found is None or found.model.kind != MODEL_KIND_CHAT:
            return None
        return ChatEndpoint(
            base_url=found.provider.base_url,
            api_key=found.provider.api_key,
            model=found.model.name,
            timeout_s=timeout_s,
            extra_body=found.provider.extra_body,
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
        if found.model.dimensions is None:
            return None
        return EmbeddingEndpoint(
            base_url=found.provider.base_url,
            api_key=found.provider.api_key,
            model=found.model.name,
            timeout_s=timeout_s,
            dimensions=found.model.dimensions,
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
                "base_url": one.base_url,
                "is_enabled": one.is_enabled,
                "extra_body": one.extra_body,
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
    base_url: str = Field(min_length=1)
    api_key: str
    is_enabled: bool = True
    extra_body: dict[str, Any] | None = None
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
        base_url=wire.base_url,
        api_key=SecretStr(wire.api_key),
        is_enabled=wire.is_enabled,
        extra_body=wire.extra_body,
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
