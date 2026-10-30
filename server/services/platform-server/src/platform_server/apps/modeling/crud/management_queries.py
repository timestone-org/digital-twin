"""管理列表的数据库过滤、稳定排序与批量关系查询。"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Select,
    SQLColumnExpression,
    Subquery,
    func,
    literal,
    select,
    tuple_,
)
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.crud.model_version import (
    identities_statement,
)
from platform_server.apps.modeling.crud.template import (
    InstanceRecord,
    records_statement,
)
from platform_server.apps.modeling.models import (
    ModelingApiKey,
    ModelingDeployment,
    ModelingModelVersion,
    ModelingPipeline,
    ModelingRuleVersion,
    ModelingRun,
    ModelVersion,
)
from platform_server.apps.modeling.models.template import ModelingInstance
from platform_server.apps.modeling.schemas.management import (
    DeploymentListQuery,
    HistoryListQuery,
    InstanceListQuery,
    ManagementCursor,
    ManagementListQuery,
    RunListQuery,
    VersionListQuery,
)


async def list_instances(
    session: AsyncSession,
    query: InstanceListQuery,
    anchor: ManagementCursor | None,
) -> tuple[list[InstanceRecord], int]:
    statement = records_statement()
    if query.q:
        statement = statement.where(
            ModelingPipeline.name.contains(query.q, autoescape=True)
            | ModelingPipeline.code.contains(query.q, autoescape=True)
        )
    if query.code is not None:
        statement = statement.where(ModelingPipeline.code == query.code)
    if query.template_id is not None:
        statement = statement.where(
            ModelingInstance.template_id == query.template_id
        )
    if query.latest_run_status is not None:
        statement = statement.where(
            ModelingRun.status == query.latest_run_status
        )
    if query.has_runs is not None:
        statement = statement.where(
            ModelingRun.id.is_not(None)
            if query.has_runs
            else ModelingRun.id.is_(None)
        )
    if query.archived != "all":
        statement = statement.where(
            ModelingInstance.archived_at.is_(None)
            if query.archived == "active"
            else ModelingInstance.archived_at.is_not(None)
        )
    total = await _total(session, statement, query)
    moment = (
        ModelingInstance.created_at
        if query.pagination == "cursor"
        else ModelingInstance.updated_at
    )
    statement = _bounded(
        statement, query, anchor, (moment, ModelingInstance.id)
    )
    rows = await session.execute(statement)
    return [InstanceRecord(*row) for row in rows.all()], total


async def list_runs(
    session: AsyncSession, query: RunListQuery, anchor: ManagementCursor | None
) -> tuple[list[ModelingRun], int]:
    statement = select(ModelingRun)
    identity = query.instance_id or query.pipeline_id
    if identity is not None:
        statement = statement.where(ModelingRun.pipeline_id == identity)
    if query.instance_id is not None:
        statement = statement.where(
            ModelingRun.pipeline_id.in_(select(ModelingInstance.id))
        )
    if query.status is not None:
        statement = statement.where(ModelingRun.status == query.status)
    if query.q:
        statement = statement.where(
            ModelingRun.pipeline_id.in_(
                select(ModelingPipeline.id).where(
                    ModelingPipeline.name.contains(query.q, autoescape=True)
                    | ModelingPipeline.code.contains(query.q, autoescape=True)
                )
            )
        )
    statement = _time_bounds(statement, query, ModelingRun.created_at)
    total = await _total(session, statement, query)
    rows = await session.scalars(
        _bounded(
            statement, query, anchor, (ModelingRun.created_at, ModelingRun.id)
        )
    )
    return list(rows.all()), total


async def list_versions(
    session: AsyncSession,
    query: VersionListQuery,
    anchor: ManagementCursor | None,
) -> tuple[list[ModelVersion], int]:
    versions = identities_statement()
    statement = select(versions.c.id, versions.c.created_at, versions.c.version)
    identity = query.instance_id or query.pipeline_id
    if identity is not None:
        statement = statement.where(versions.c.pipeline_id == identity)
    if query.instance_id is not None:
        statement = statement.where(
            versions.c.pipeline_id.in_(select(ModelingInstance.id))
        )
    if query.q:
        statement = statement.where(
            versions.c.name.contains(query.q, autoescape=True)
        )
    if query.task is not None:
        statement = statement.where(versions.c.task == query.task)
    if query.is_servable is not None:
        statement = statement.where(versions.c.servable == query.is_servable)
    if query.archived != "all":
        statement = statement.where(
            versions.c.archived_at.is_(None)
            if query.archived == "active"
            else versions.c.archived_at.is_not(None)
        )
    statement = _time_bounds(statement, query, versions.c.created_at)
    total = await _total(session, statement, query)
    order = (
        versions.c.created_at
        if query.pagination == "cursor"
        else versions.c.version
    )
    selected = _bounded(
        statement, query, anchor, (order, versions.c.id)
    ).subquery()
    return await _version_rows(session, selected, query), total


async def instance_ids(
    session: AsyncSession, identities: list[uuid.UUID]
) -> set[uuid.UUID]:
    return set(
        await session.scalars(
            select(ModelingInstance.id).where(
                ModelingInstance.id.in_(identities)
            )
        )
    )


async def list_version_deployments(
    session: AsyncSession,
    identity: uuid.UUID,
    query: ManagementListQuery,
    anchor: ManagementCursor | None,
) -> list[ModelingDeployment]:
    row = ModelingDeployment
    statement = select(row).where(
        (row.model_version_id == identity) | (row.rule_version_id == identity)
    )
    if query.q:
        statement = statement.where(
            row.name.contains(query.q, autoescape=True)
            | row.code.contains(query.q, autoescape=True)
        )
    return list(
        await session.scalars(
            _bounded(statement, query, anchor, (row.created_at, row.id))
        )
    )


async def published_versions(
    session: AsyncSession, runs: list[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    versions = identities_statement()
    rows = await session.execute(
        select(versions.c.run_id, versions.c.id).where(
            versions.c.run_id.in_(runs)
        )
    )
    return {
        uuid.UUID(str(run)): uuid.UUID(str(version)) for run, version in rows
    }


async def deployment_counts(
    session: AsyncSession, versions: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    identity = func.coalesce(
        ModelingDeployment.model_version_id, ModelingDeployment.rule_version_id
    )
    rows = await session.execute(
        select(identity, func.count())
        .where(identity.in_(versions))
        .group_by(identity)
    )
    return {uuid.UUID(str(key)): int(count) for key, count in rows}


async def api_key_counts(
    session: AsyncSession, deployments: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    row = ModelingApiKey
    rows = await session.execute(
        select(row.deployment_id, func.count())
        .where(row.deployment_id.in_(deployments))
        .group_by(row.deployment_id)
    )
    return {identity: int(count) for identity, count in rows}


async def _total[RowT: tuple[object, ...]](
    session: AsyncSession, statement: Select[RowT], query: ManagementListQuery
) -> int:
    if query.pagination == "cursor":
        return 0
    return int(
        await session.scalar(
            select(func.count()).select_from(statement.subquery())
        )
        or 0
    )


def _bounded[RowT: tuple[object, ...]](
    statement: Select[RowT],
    query: ManagementListQuery,
    anchor: ManagementCursor | None,
    order: tuple[
        SQLColumnExpression[datetime] | SQLColumnExpression[int],
        SQLColumnExpression[uuid.UUID],
    ],
) -> Select[RowT]:
    moment, identity = order
    if anchor is not None:
        statement = statement.where(
            tuple_(moment, identity)
            < tuple_(literal(anchor.created_at), literal(anchor.identity))
        )
    statement = statement.order_by(moment.desc(), identity.desc())
    if query.pagination == "cursor":
        return statement.limit(query.limit + 1)
    return statement.offset((query.page - 1) * query.size).limit(query.size)


def _time_bounds[RowT: tuple[object, ...]](
    statement: Select[RowT],
    query: HistoryListQuery,
    moment: SQLColumnExpression[datetime],
) -> Select[RowT]:
    if query.created_since is not None:
        statement = statement.where(moment >= query.created_since)
    if query.created_until is not None:
        statement = statement.where(moment < query.created_until)
    return statement


async def _version_rows(
    session: AsyncSession,
    selected: Subquery,
    query: VersionListQuery,
) -> list[ModelVersion]:
    order = (
        selected.c.created_at
        if query.pagination == "cursor"
        else selected.c.version
    )
    statement = (
        select(ModelingModelVersion, ModelingRuleVersion)
        .select_from(selected)
        .outerjoin(
            ModelingModelVersion, ModelingModelVersion.id == selected.c.id
        )
        .outerjoin(ModelingRuleVersion, ModelingRuleVersion.id == selected.c.id)
        .order_by(order.desc(), selected.c.id.desc())
    )
    rows = await session.execute(statement)
    return [
        trained or rule
        for trained, rule in rows
        if trained is not None or rule is not None
    ]


async def list_deployments(
    session: AsyncSession, query: DeploymentListQuery
) -> list[tuple[ModelingDeployment, ModelVersion]]:
    row = ModelingDeployment
    effective = func.coalesce(row.model_version_id, row.rule_version_id)
    statement = (
        select(row, ModelingModelVersion, ModelingRuleVersion)
        .outerjoin(
            ModelingModelVersion,
            row.model_version_id == ModelingModelVersion.id,
        )
        .outerjoin(
            ModelingRuleVersion, row.rule_version_id == ModelingRuleVersion.id
        )
    )
    if query.code is not None:
        statement = statement.where(row.code == query.code)
    if query.model_version_id is not None:
        statement = statement.where(effective == query.model_version_id)
    if query.is_enabled is not None:
        statement = statement.where(row.is_enabled == query.is_enabled)
    if query.instance_id is not None:
        versions = identities_statement()
        selected = select(versions.c.id).where(
            versions.c.pipeline_id == query.instance_id,
            versions.c.pipeline_id.in_(select(ModelingInstance.id)),
        )
        statement = statement.where(effective.in_(selected))
    rows = await session.execute(
        statement.order_by(row.created_at.desc(), row.id.desc())
    )
    return [
        (deployment, trained or rule)
        for deployment, trained, rule in rows
        if trained is not None or rule is not None
    ]
