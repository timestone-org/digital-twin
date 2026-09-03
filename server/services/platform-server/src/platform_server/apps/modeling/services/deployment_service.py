"""对外服务的管理面：建改删部署、铸与撤销密钥、看调用量。事务边界在这一层。

⚠ 明文密钥只在铸出来那一次的回执里出现。本模块任何读接口都不回明文，
也没有任何地方存明文（docs/MODELING_PLATFORM_DESIGN.md D13）。
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.crud import (
    api_key_crud,
    call_log_crud,
    deployment_crud,
    model_version_crud,
)
from platform_server.apps.modeling.errors import (
    ApiKeyNotFound,
    DeploymentCodeTaken,
    DeploymentNotFound,
    ModelVersionNotFound,
)
from platform_server.apps.modeling.models import (
    ModelingApiKey,
    ModelingDeployment,
    ModelingModelVersion,
)
from platform_server.apps.modeling.schemas import (
    ModelApiKeyCreateIn,
    ModelApiKeyMintedOut,
    ModelApiKeyOut,
    ModelCallStatOut,
    ModelDeploymentCreateIn,
    ModelDeploymentOut,
    ModelDeploymentUpdateIn,
)
from platform_server.apps.modeling.services import api_key
from platform_server.apps.modeling.services.pipeline_service import Actor

# 调用量默认回看多少天
STATS_WINDOW_DAYS = 30


@dataclass(frozen=True)
class _Presented:
    """一个部署加上展示要用的那几样。"""

    row: ModelingDeployment
    version: ModelingModelVersion
    key_count: int


async def create_deployment(
    session: AsyncSession, *, payload: ModelDeploymentCreateIn, actor: Actor
) -> ModelDeploymentOut:
    """开一个对外服务。

    ⚠ `code` 撞车靠数据库上的唯一约束判，不靠先查一次：并发建同名时先查那次
    两边都会说「没占用」。
    Args: session, payload, actor。
    """
    version = await _require_version(session, payload.model_version_id)
    row = deployment_crud.add(
        session,
        ModelingDeployment(
            code=payload.code,
            model_version_id=version.id,
            name=payload.name,
            description=payload.description,
            max_rows_per_call=payload.max_rows_per_call,
            rate_limit_per_minute=payload.rate_limit_per_minute,
            created_by=actor.user_id,
            created_by_name=actor.name,
        ),
    )
    try:
        await session.flush()
    except IntegrityError as error:
        raise DeploymentCodeTaken(
            f"对外标识「{payload.code}」已经被别的服务占了"
        ) from error
    return _present(_Presented(row=row, version=version, key_count=0))


async def list_deployments(session: AsyncSession) -> list[ModelDeploymentOut]:
    """全部对外服务。

    Args: session。
    """
    rows = await deployment_crud.list_all(session)
    presented: list[ModelDeploymentOut] = []
    for row in rows:
        version = await model_version_crud.get(session, row.model_version_id)
        keys = await api_key_crud.list_by_deployment(session, row.id)
        if version is not None:
            presented.append(
                _present(
                    _Presented(row=row, version=version, key_count=len(keys))
                )
            )
    return presented


async def get_deployment(
    session: AsyncSession, deployment_id: uuid.UUID
) -> ModelDeploymentOut:
    """一个对外服务的详情。

    Args: session, deployment_id。
    """
    return _present(await _presented(session, deployment_id))


async def update_deployment(
    session: AsyncSession,
    *,
    deployment_id: uuid.UUID,
    payload: ModelDeploymentUpdateIn,
) -> ModelDeploymentOut:
    """改一个对外服务。`code` 不在可改之列。

    Args: session, deployment_id, payload。
    """
    found = await _presented(session, deployment_id)
    row = found.row
    version = found.version
    if payload.model_version_id is not None:
        version = await _require_version(session, payload.model_version_id)
        row.model_version_id = version.id
    _apply_patch(row, payload)
    await session.flush()
    return _present(
        _Presented(row=row, version=version, key_count=found.key_count)
    )


def _apply_patch(
    row: ModelingDeployment, payload: ModelDeploymentUpdateIn
) -> None:
    """把补丁里给了的那几格写上去。

    Args: row, payload。
    """
    if payload.name is not None:
        row.name = payload.name
    if payload.description is not None:
        row.description = payload.description
    if payload.is_enabled is not None:
        row.is_enabled = payload.is_enabled
    if payload.max_rows_per_call is not None:
        row.max_rows_per_call = payload.max_rows_per_call
    if payload.rate_limit_per_minute is not None:
        row.rate_limit_per_minute = payload.rate_limit_per_minute


async def delete_deployment(
    session: AsyncSession, deployment_id: uuid.UUID
) -> None:
    """删一个对外服务。密钥与调用记录跟着删。

    ⚠ 删了之后那个 URL 立刻 404。对方系统会当场报错——这正是要的：
    停一段时间再删的话，那段时间里对方以为还通着。
    Args: session, deployment_id。
    """
    found = await _presented(session, deployment_id)
    await deployment_crud.delete(session, found.row)


async def create_key(
    session: AsyncSession,
    *,
    deployment_id: uuid.UUID,
    payload: ModelApiKeyCreateIn,
    actor: Actor,
) -> ModelApiKeyMintedOut:
    """铸一把新钥匙。**明文只在这个回执里出现一次。**

    Args: session, deployment_id, payload, actor。
    """
    found = await _presented(session, deployment_id)
    minted = api_key.mint()
    row = api_key_crud.add(
        session,
        ModelingApiKey(
            deployment_id=found.row.id,
            name=payload.name,
            key_prefix=minted.prefix,
            key_hash=minted.digest,
            expires_at=payload.expires_at,
            created_by=actor.user_id,
            created_by_name=actor.name,
        ),
    )
    await session.flush()
    return ModelApiKeyMintedOut(
        **_to_key_out(row).model_dump(), plaintext=minted.plaintext
    )


async def list_keys(
    session: AsyncSession, deployment_id: uuid.UUID
) -> list[ModelApiKeyOut]:
    """一个部署下的全部密钥。⚠ 一把明文都没有。

    Args: session, deployment_id。
    """
    found = await _presented(session, deployment_id)
    rows = await api_key_crud.list_by_deployment(session, found.row.id)
    return [_to_key_out(row) for row in rows]


async def revoke_key(
    session: AsyncSession, *, deployment_id: uuid.UUID, key_id: uuid.UUID
) -> ModelApiKeyOut:
    """撤销一把钥匙。立刻生效。

    ⚠ 撤销是打标记不是删行：删了之后调用记录里的那一列会置空，
    「哪把钥匙在被谁用」就查不出来了。
    Args: session, deployment_id, key_id。
    """
    row = await api_key_crud.get(session, key_id)
    if row is None or row.deployment_id != deployment_id:
        raise ApiKeyNotFound("这把密钥不存在")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
    await session.flush()
    return _to_key_out(row)


async def daily_stats(
    session: AsyncSession, deployment_id: uuid.UUID
) -> list[ModelCallStatOut]:
    """近一个月按天的调用量与出错量。

    Args: session, deployment_id。
    """
    found = await _presented(session, deployment_id)
    since = datetime.now(UTC) - timedelta(days=STATS_WINDOW_DAYS)
    rows = await call_log_crud.daily_counts(session, found.row.id, since)
    return [
        ModelCallStatOut(day=day, total=total, failed=failed)
        for day, total, failed in rows
    ]


async def _presented(
    session: AsyncSession, deployment_id: uuid.UUID
) -> _Presented:
    """取一个部署连同它钉的版本与密钥数；缺任何一样都当作不存在。

    Args: session, deployment_id。
    """
    row = await deployment_crud.get(session, deployment_id)
    if row is None:
        raise DeploymentNotFound("这个对外服务不存在")
    version = await model_version_crud.get(session, row.model_version_id)
    if version is None:  # pragma: no cover —— 外键是 RESTRICT，删不掉
        raise DeploymentNotFound("这个对外服务钉的模型版本已不存在")
    keys = await api_key_crud.list_by_deployment(session, row.id)
    return _Presented(row=row, version=version, key_count=len(keys))


async def _require_version(
    session: AsyncSession, version_id: uuid.UUID
) -> ModelingModelVersion:
    """取一个模型版本，不存在即抛。

    Args: session, version_id。
    """
    version = await model_version_crud.get(session, version_id)
    if version is None:
        raise ModelVersionNotFound("这个模型版本不存在")
    return version


def _present(found: _Presented) -> ModelDeploymentOut:
    """摆成对外的形状。

    Args: found。
    """
    row = found.row
    return ModelDeploymentOut(
        id=row.id,
        code=row.code,
        model_version_id=row.model_version_id,
        model_name=found.version.name,
        model_version=found.version.version,
        name=row.name,
        description=row.description,
        is_enabled=row.is_enabled,
        is_servable=found.version.servable,
        unservable_reason=found.version.unservable_reason,
        max_rows_per_call=row.max_rows_per_call,
        rate_limit_per_minute=row.rate_limit_per_minute,
        key_count=found.key_count,
        created_by_name=row.created_by_name,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _to_key_out(row: ModelingApiKey) -> ModelApiKeyOut:
    """摆成对外的形状。⚠ 没有明文这一格。

    Args: row。
    """
    return ModelApiKeyOut(
        id=row.id,
        deployment_id=row.deployment_id,
        name=row.name,
        key_prefix=row.key_prefix,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        last_used_at=row.last_used_at,
        created_by_name=row.created_by_name,
        created_at=row.created_at,
    )
