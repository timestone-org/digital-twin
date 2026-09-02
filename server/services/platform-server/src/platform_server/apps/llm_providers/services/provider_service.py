"""供应商的读写编排。事务边界在本层：crud 只写不提交（database-standard §6）。

⚠ 密钥在这一层加密落库、只以尾巴几位出门。解不开的密文（换过加密密钥）按
「没配」处理并响亮记日志——那时目录里这一路不下发，界面上要重填一次密钥。
"""

import uuid
from typing import Any, cast

from sqlalchemy.ext.asyncio import AsyncSession

from lib.crypto import SecretCipher
from lib.logging import get_logger
from platform_server.apps.llm_providers import crud
from platform_server.apps.llm_providers.errors import (
    LlmProviderInUse,
    LlmProviderNameTaken,
    LlmProviderNotFound,
)
from platform_server.apps.llm_providers.models import LlmProvider
from platform_server.apps.llm_providers.models.provider import (
    API_KEY_HINT_CHARS,
)
from platform_server.apps.llm_providers.schemas import (
    LlmModelIn,
    LlmModelOut,
    LlmProviderIn,
    LlmProviderOut,
    LlmProviderUpdateIn,
)

_logger = get_logger("platform.llm_providers")


def key_hint(api_key: str) -> str:
    """密钥尾巴几位，前面打码。⚠ 只够认出「是哪一把」，不够猜。

    Args: api_key。
    """
    if len(api_key) <= API_KEY_HINT_CHARS:
        return "…" + "*" * len(api_key)
    return f"…{api_key[-API_KEY_HINT_CHARS:]}"


def models_json_of(models: list[LlmModelIn]) -> list[dict[str, Any]]:
    """入参的模型清单摊成落库的形状。

    Args: models。
    """
    return [
        {
            "name": one.name,
            "kind": one.kind,
            "has_vision": one.has_vision,
            "dimensions": one.dimensions,
        }
        for one in models
    ]


def models_of(row: LlmProvider) -> list[LlmModelOut]:
    """库里那一格摊成出参。⚠ 不成形的条目跳过而不是抛：一条坏数据不该让整个
    列表 500，而写入侧已经按 schema 校验过。

    Args: row。
    """
    found: list[LlmModelOut] = []
    for item in cast("list[object]", row.models_json):
        if not isinstance(item, dict):
            continue
        fields = cast("dict[str, Any]", item)
        name = fields.get("name")
        kind = fields.get("kind")
        if not isinstance(name, str) or not isinstance(kind, str):
            continue
        dimensions = fields.get("dimensions")
        found.append(
            LlmModelOut(
                name=name,
                kind=kind,
                has_vision=bool(fields.get("has_vision", False)),
                dimensions=dimensions if isinstance(dimensions, int) else None,
            )
        )
    return found


def provider_out(row: LlmProvider, assigned: list[str]) -> LlmProviderOut:
    """一行摊成出参。⚠ 密钥不在里面，也永远不该在。

    Args: row, assigned（指着它的用途码）。
    """
    return LlmProviderOut(
        id=row.id,
        name=row.name,
        base_url=row.base_url,
        api_key_hint=row.api_key_hint,
        is_enabled=row.is_enabled,
        extra_body=row.extra_body_json,
        models=models_of(row),
        notes=row.notes,
        assigned_purposes=assigned,
        updated_by=row.updated_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def list_providers(
    session: AsyncSession, *, offset: int, limit: int
) -> tuple[list[LlmProviderOut], int]:
    """列一页供应商与总数。

    Args: session, offset, limit。
    """
    rows, total = await crud.provider.list_page(
        session, offset=offset, limit=limit
    )
    assigned = _assigned_map(await crud.assignment.list_all(session))
    return [provider_out(one, assigned.get(one.id, [])) for one in rows], total


async def read_provider(
    session: AsyncSession, provider_id: uuid.UUID
) -> LlmProviderOut:
    """取一路供应商。

    Args: session, provider_id。
    """
    row = await _row(session, provider_id)
    return provider_out(
        row, await crud.assignment.purposes_of(session, provider_id)
    )


async def create_provider(
    session: AsyncSession,
    body: LlmProviderIn,
    *,
    cipher: SecretCipher,
    actor: str,
) -> LlmProviderOut:
    """建一路供应商。名字撞了给 409。

    Args: session, body, cipher, actor。
    """
    if await crud.provider.by_name(session, body.name) is not None:
        raise LlmProviderNameTaken(f"已经有一路叫「{body.name}」的供应商")
    secret = body.api_key.get_secret_value()
    row = crud.provider.add(
        session,
        LlmProvider(
            name=body.name,
            base_url=body.base_url.rstrip("/"),
            api_key_enc=cipher.encrypt(secret),
            api_key_hint=key_hint(secret),
            is_enabled=body.is_enabled,
            extra_body_json=body.extra_body,
            models_json=models_json_of(body.models),
            notes=body.notes,
            updated_by=actor,
        ),
    )
    # ⚠ flush 不 commit：事务由依赖注入收口，提前 commit 取 id
    # 会把一次写拆成两段
    await session.flush()
    _logger.info("llm_provider_created", "新建了一路模型供应商", actor=actor)
    return provider_out(row, [])


async def update_provider(
    session: AsyncSession,
    provider_id: uuid.UUID,
    body: LlmProviderUpdateIn,
    *,
    cipher: SecretCipher,
    actor: str,
) -> LlmProviderOut:
    """改一路供应商。只动带了的字段。

    Args: session, provider_id, body, cipher, actor。
    """
    row = await _row(session, provider_id)
    if body.name is not None and body.name != row.name:
        if await crud.provider.by_name(session, body.name) is not None:
            raise LlmProviderNameTaken(f"已经有一路叫「{body.name}」的供应商")
        row.name = body.name
    _apply_plain_fields(row, body)
    if body.api_key is not None:
        secret = body.api_key.get_secret_value()
        row.api_key_enc = cipher.encrypt(secret)
        row.api_key_hint = key_hint(secret)
    row.updated_by = actor
    await session.flush()
    _logger.info("llm_provider_updated", "改了一路模型供应商", actor=actor)
    return provider_out(
        row, await crud.assignment.purposes_of(session, provider_id)
    )


async def delete_provider(
    session: AsyncSession, provider_id: uuid.UUID, *, actor: str
) -> None:
    """删一路供应商。还被用途指着就 409——先把用途改指别处。

    Args: session, provider_id, actor。
    """
    row = await _row(session, provider_id)
    if await crud.assignment.count_for(session, provider_id) > 0:
        raise LlmProviderInUse("这一路还被某个用途指着，先把那些用途改指别处")
    await crud.provider.delete(session, row)
    _logger.info("llm_provider_deleted", "删了一路模型供应商", actor=actor)


async def stored_api_key(
    session: AsyncSession, provider_id: uuid.UUID, *, cipher: SecretCipher
) -> tuple[str, str]:
    """取一路的端点与解开的密钥，给「按已存的密钥探一次」用。

    ⚠ 只给探测这一条路用，绝不摊进任何出参。解不开时给空串，探测会如实报
    「拒绝了这把密钥」。

    Args: session, provider_id, cipher。
    """
    row = await _row(session, provider_id)
    return row.base_url, cipher.decrypt(row.api_key_enc) or ""


def _apply_plain_fields(row: LlmProvider, body: LlmProviderUpdateIn) -> None:
    """把不涉及密钥的几格盖到行上。

    Args: row, body。
    """
    if body.base_url is not None:
        row.base_url = body.base_url.rstrip("/")
    if body.is_enabled is not None:
        row.is_enabled = body.is_enabled
    if "extra_body" in body.model_fields_set:
        row.extra_body_json = body.extra_body
    if body.models is not None:
        row.models_json = models_json_of(body.models)
    if body.notes is not None:
        row.notes = body.notes


async def _row(session: AsyncSession, provider_id: uuid.UUID) -> LlmProvider:
    row = await crud.provider.get(session, provider_id)
    if row is None:
        raise LlmProviderNotFound("没有这一路供应商")
    return row


def _assigned_map(rows: list[Any]) -> dict[uuid.UUID, list[str]]:
    """按供应商 id 归拢指着它的用途码。

    Args: rows（分配行）。
    """
    found: dict[uuid.UUID, list[str]] = {}
    for one in rows:
        found.setdefault(one.provider_id, []).append(one.purpose)
    return found
