"""给消费方下发的目录：全部供应商（密钥就地解开）+ 全部用途分配 + 内容摘要。

⚠ 这一份**只走内部面**（服务级密钥），密钥明文只在集群网内走一跳。对外面那些
端点一律只露尾巴。

⚠ 解不开密钥的那一路（换过加密密钥）**整路不下发**并响亮记日志：下发一个空
密钥等于让消费方每次调用撞 401，而那一档刻意不打开断路器。
"""

import hashlib
import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from lib.crypto import SecretCipher
from lib.logging import get_logger
from platform_server.apps.llm_providers import crud
from platform_server.apps.llm_providers.models import LlmProvider
from platform_server.apps.llm_providers.services.provider_service import (
    models_of,
)

_logger = get_logger("platform.llm_providers.catalog")

# 摘要留几位。只用来判「变没变」，不做对账
VERSION_CHARS = 16


class CatalogModelOut(BaseModel):
    """目录里一个模型的线形。与 llmcore 的 `_ModelWire` 逐字段对齐。"""

    model_config = ConfigDict(frozen=True)

    name: str
    kind: str
    has_vision: bool
    dimensions: int | None


class CatalogProviderOut(BaseModel):
    """目录里一路供应商的线形。⚠ 带明文密钥，只走内部面。

    ⚠ 字段集与 llmcore 的 `catalog_version` 逐格对齐：内容摘要两侧各算一遍，
    少一格就永远算不出同一个值，而「变没变」于是判错。
    """

    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    kind: str
    # 没有端点的那些形态是空串
    base_url: str
    api_key: str
    is_enabled: bool
    extra_body: dict[str, Any] | None
    options: dict[str, Any] | None
    models: list[CatalogModelOut]


class CatalogAssignmentOut(BaseModel):
    """目录里一条用途分配的线形。"""

    model_config = ConfigDict(frozen=True)

    purpose: str
    provider_id: str
    model_name: str


class CatalogOut(BaseModel):
    """内部接口的 `data` 段。"""

    model_config = ConfigDict(frozen=True)

    version: str
    providers: list[CatalogProviderOut] = Field(
        default_factory=list[CatalogProviderOut]
    )
    assignments: list[CatalogAssignmentOut] = Field(
        default_factory=list[CatalogAssignmentOut]
    )


async def build_catalog(
    session: AsyncSession, *, cipher: SecretCipher | None
) -> CatalogOut:
    """装出此刻的全量目录。没配加密密钥时是空目录——消费方于是退回环境变量。

    Args: session, cipher。
    """
    if cipher is None:
        return CatalogOut(version="")
    providers = [
        one
        for one in (
            _provider_out(row, cipher)
            for row in await crud.provider.list_all(session)
        )
        if one is not None
    ]
    assignments = [
        CatalogAssignmentOut(
            purpose=row.purpose,
            provider_id=str(row.provider_id),
            model_name=row.model_name,
        )
        for row in await crud.assignment.list_all(session)
    ]
    return CatalogOut(
        version=_version(providers, assignments),
        providers=providers,
        assignments=assignments,
    )


def _provider_out(
    row: LlmProvider, cipher: SecretCipher
) -> CatalogProviderOut | None:
    """一路摊成线形；密钥解不开就整路不下发。

    ⚠ 靠登录的那些形态本来就没有密钥，那时**不是**「解不开」：整路照常下发，
    能不能用由消费方那一侧的登录态回答。

    Args: row, cipher。
    """
    api_key = ""
    if row.api_key_enc is not None:
        decrypted = cipher.decrypt(row.api_key_enc)
        if decrypted is None:
            _logger.error(
                "llm_provider_key_undecryptable",
                "这一路的密钥解不开（换过加密密钥），本轮不下发，请重填密钥",
                provider=row.name,
            )
            return None
        api_key = decrypted
    return CatalogProviderOut(
        id=str(row.id),
        name=row.name,
        kind=row.kind,
        base_url=row.base_url or "",
        api_key=api_key,
        is_enabled=row.is_enabled,
        extra_body=row.extra_body_json,
        options=row.options_json,
        models=[
            CatalogModelOut(
                name=one.name,
                kind=one.kind,
                has_vision=one.has_vision,
                dimensions=one.dimensions,
            )
            for one in models_of(row)
        ],
    )


def _version(
    providers: list[CatalogProviderOut],
    assignments: list[CatalogAssignmentOut],
) -> str:
    """内容摘要。⚠ 密钥**不进摘要**：它会进日志与响应。

    Args: providers, assignments。
    """
    body = {
        "providers": [one.model_dump(exclude={"api_key"}) for one in providers],
        "assignments": [one.model_dump() for one in assignments],
    }
    compact = json.dumps(body, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(compact.encode("utf-8")).hexdigest()[:VERSION_CHARS]
