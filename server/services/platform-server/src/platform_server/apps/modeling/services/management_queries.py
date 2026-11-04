"""模型管理查询与显式实例、版本、部署关系。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import CursorPage, Page
from platform_server.apps.dataset.services import formula_library
from platform_server.apps.modeling.crud import binding_crud, management_queries
from platform_server.apps.modeling.schemas.deployment import ModelDeploymentOut
from platform_server.apps.modeling.schemas.management import (
    BindingListQuery,
    CursorListQuery,
    DeploymentListQuery,
    InstanceListQuery,
    RunListQuery,
    VersionListQuery,
)
from platform_server.apps.modeling.schemas.model import (
    ModelBindingOut,
    ModelVersionSummaryOut,
)
from platform_server.apps.modeling.schemas.run import RunSummaryOut
from platform_server.apps.modeling.schemas.template import ModelingInstanceOut
from platform_server.apps.modeling.services import deployment_service
from platform_server.apps.modeling.services.instance_service import to_instance
from platform_server.apps.modeling.services.management_cursor import (
    paginate,
    read_cursor,
)
from platform_server.apps.modeling.services.model_service import (
    to_binding_out,
    to_version_summary,
)
from platform_server.apps.modeling.services.presenters import to_run_summary
from platform_server.apps.modeling.services.publish_service import (
    require_version,
)
from platform_server.settings import API_PREFIX


async def list_instances(
    session: AsyncSession, query: InstanceListQuery
) -> Page[ModelingInstanceOut] | CursorPage[ModelingInstanceOut]:
    rows, total = await management_queries.list_instances(
        session, query, read_cursor(query, "instances")
    )
    return paginate(
        [to_instance(row) for row in rows], total, query, "instances"
    )


async def list_runs(
    session: AsyncSession, query: RunListQuery
) -> Page[RunSummaryOut] | CursorPage[RunSummaryOut]:
    rows, total = await management_queries.list_runs(
        session, query, read_cursor(query, "runs")
    )
    instances = await management_queries.instance_ids(
        session, [row.pipeline_id for row in rows]
    )
    versions = await management_queries.published_versions(
        session, [row.id for row in rows]
    )
    workflows = await management_queries.pipeline_labels(
        session, [row.pipeline_id for row in rows]
    )
    items = [
        to_run_summary(row).model_copy(
            update={
                "instance_id": (
                    row.pipeline_id if row.pipeline_id in instances else None
                ),
                "published_version_id": versions.get(row.id),
                "pipeline_name": workflows.get(row.pipeline_id, (None, None))[
                    0
                ],
                "pipeline_code": workflows.get(row.pipeline_id, (None, None))[
                    1
                ],
            }
        )
        for row in rows
    ]
    return paginate(items, total, query, "runs")


async def list_versions(
    session: AsyncSession, query: VersionListQuery
) -> Page[ModelVersionSummaryOut] | CursorPage[ModelVersionSummaryOut]:
    rows, total = await management_queries.list_versions(
        session, query, read_cursor(query, "versions")
    )
    instances = await management_queries.instance_ids(
        session, [row.pipeline_id for row in rows]
    )
    counts = await management_queries.deployment_counts(
        session, [row.id for row in rows]
    )
    items = [
        to_version_summary(row).model_copy(
            update=version_relations(row.id, row.pipeline_id, instances, counts)
        )
        for row in rows
    ]
    return paginate(items, total, query, "versions")


def version_relations(
    identity: uuid.UUID,
    pipeline_id: uuid.UUID,
    instances: set[uuid.UUID],
    counts: dict[uuid.UUID, int],
) -> dict[str, object]:
    return {
        "instance_id": pipeline_id if pipeline_id in instances else None,
        "deployment_count": counts.get(identity, 0),
        "deployments_url": (
            f"{API_PREFIX}/modeling-model-versions/" f"{identity}/deployments"
        ),
    }


async def list_version_deployments(
    session: AsyncSession,
    identity: uuid.UUID,
    query: CursorListQuery,
) -> CursorPage[ModelDeploymentOut]:
    version = await require_version(session, identity)
    resource = f"version-deployments:{identity}"
    rows = await management_queries.list_version_deployments(
        session, identity, query, read_cursor(query, resource)
    )
    keys = await management_queries.api_key_counts(
        session, [row.id for row in rows]
    )
    items = deployment_service.present_for_version(rows, version, keys)
    result = paginate(items, 0, query, resource)
    if not isinstance(result, CursorPage):
        raise RuntimeError("版本关联部署使用游标分页")
    return result


async def list_deployments(
    session: AsyncSession, query: DeploymentListQuery
) -> list[ModelDeploymentOut] | Page[ModelDeploymentOut]:
    rows, total = await management_queries.list_deployments(session, query)
    keys = await management_queries.api_key_counts(
        session, [row.id for row, _ in rows]
    )
    items = deployment_service.present_deployment_pairs(rows, keys)
    page = query.page_params
    if page is None:
        return items
    return Page(items=items, page=page.page, size=page.size, total=total)


async def list_bindings(
    session: AsyncSession, query: BindingListQuery
) -> list[ModelBindingOut] | Page[ModelBindingOut]:
    rows, total = await binding_crud.list_filtered(session, query)
    library = await formula_library.load_library(session)
    items = [
        to_binding_out(
            row.binding, is_orphaned=row.binding.fx_code not in library.entries
        ).model_copy(
            update={
                "model_name": row.model_name,
                "model_version": row.model_version,
            }
        )
        for row in rows
    ]
    page = query.page_params
    if page is None:
        return items
    return Page(items=items, page=page.page, size=page.size, total=total)
