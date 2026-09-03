"""用途分配的读写编排：把一个用途指到一路供应商上的一个模型，或清掉。

⚠ 写入时把用途、模型与种类校验对齐：嵌入用途不许指对话模型，看图用途不许
指不接图的模型。留到消费方那一侧才发现的话，表现是「界面上分配了、那一侧却
还在用环境变量那一档」，而两边代码单看都对。
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.llm_providers import crud
from platform_server.apps.llm_providers.enums import (
    PURPOSES,
    PurposeSpec,
    provider_kind_of,
    purpose_of,
)
from platform_server.apps.llm_providers.errors import (
    LlmModelUnknown,
    LlmProviderNotFound,
    LlmPurposeMismatch,
    LlmPurposeUnknown,
)
from platform_server.apps.llm_providers.models import (
    LlmAssignment,
    LlmProvider,
)
from platform_server.apps.llm_providers.rules import purpose_mismatch
from platform_server.apps.llm_providers.schemas import (
    LlmAssignmentIn,
    LlmModelOut,
    LlmPurposeOut,
)
from platform_server.apps.llm_providers.services.provider_service import (
    models_of,
)

_logger = get_logger("platform.llm_providers")


def purpose_out(
    spec: PurposeSpec,
    row: LlmAssignment | None,
    provider: LlmProvider | None,
) -> LlmPurposeOut:
    """一个用途摊成出参。

    Args: spec, row（分配行；没分配是 None）, provider（被指的那一路）。
    """
    return LlmPurposeOut(
        purpose=spec.code,
        label=spec.label,
        description=spec.description,
        kind=spec.kind,
        consumer=spec.consumer,
        is_vision_required=spec.is_vision_required,
        has_env_default=spec.has_env_default,
        provider_id=None if row is None else row.provider_id,
        provider_name=None if provider is None else provider.name,
        model_name=None if row is None else row.model_name,
        updated_at=None if row is None else row.updated_at,
    )


async def list_purposes(session: AsyncSession) -> list[LlmPurposeOut]:
    """全部用途，按目录顺序，带各自此刻的分配。

    Args: session。
    """
    rows = {one.purpose: one for one in await crud.assignment.list_all(session)}
    providers = {one.id: one for one in await crud.provider.list_all(session)}
    return [
        purpose_out(
            spec,
            rows.get(spec.code),
            _provider_of(rows.get(spec.code), providers),
        )
        for spec in PURPOSES
    ]


async def assign(
    session: AsyncSession,
    purpose: str,
    body: LlmAssignmentIn,
    *,
    actor: str,
) -> LlmPurposeOut:
    """把一个用途指到一路供应商上的一个模型。

    Args: session, purpose, body, actor。
    """
    spec = _spec(purpose)
    provider = await crud.provider.get(session, body.provider_id)
    if provider is None:
        raise LlmProviderNotFound("没有这一路供应商")
    _check_kind(spec, provider)
    _check_model(spec, provider, body.model_name)
    row = await crud.assignment.get(session, purpose)
    if row is None:
        row = crud.assignment.add(session, LlmAssignment(purpose=purpose))
    row.provider_id = provider.id
    row.model_name = body.model_name
    row.updated_by = actor
    await session.flush()
    _logger.info(
        "llm_purpose_assigned",
        "改了一个用途走哪一路模型",
        purpose=purpose,
        actor=actor,
    )
    return purpose_out(spec, row, provider)


async def clear(session: AsyncSession, purpose: str, *, actor: str) -> None:
    """清掉一个用途的分配；本来就没分配也算成功（幂等）。

    Args: session, purpose, actor。
    """
    _spec(purpose)
    row = await crud.assignment.get(session, purpose)
    if row is None:
        return
    await crud.assignment.delete(session, row)
    _logger.info(
        "llm_purpose_cleared",
        "清掉了一个用途的分配",
        purpose=purpose,
        actor=actor,
    )


def _spec(purpose: str) -> PurposeSpec:
    spec = purpose_of(purpose)
    if spec is None:
        raise LlmPurposeUnknown("未登记的用途")
    return spec


def _check_kind(spec: PurposeSpec, provider: LlmProvider) -> None:
    """这一路的接入形态接不接得了这个用途。

    Args: spec, provider。
    """
    kind = provider_kind_of(provider.kind)
    # pragma 理由：库里那一格由 CHECK 约束拦着
    if kind is None:  # pragma: no cover
        return
    rejected = purpose_mismatch(kind, spec)
    if rejected is not None:
        raise LlmPurposeMismatch(rejected)


def _check_model(spec: PurposeSpec, provider: LlmProvider, name: str) -> None:
    """这一路上有没有这个模型，以及它配不配得上这个用途。

    Args: spec, provider, name。
    """
    model = _model_named(models_of(provider), name)
    if model is None:
        raise LlmModelUnknown(f"「{provider.name}」上没有登记模型「{name}」")
    if model.kind != spec.kind:
        raise LlmModelUnknown(f"「{name}」是{model.kind}模型，配不上这个用途")
    if spec.is_vision_required and not model.has_vision:
        raise LlmModelUnknown(f"「{name}」不接图，配不上看图这个用途")


def _model_named(models: list[LlmModelOut], name: str) -> LlmModelOut | None:
    return next((one for one in models if one.name == name), None)


def _provider_of(
    row: LlmAssignment | None, providers: dict[uuid.UUID, LlmProvider]
) -> LlmProvider | None:
    return None if row is None else providers.get(row.provider_id)
