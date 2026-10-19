"""层级图项目与历史端点。"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from hierarchy_server.apps.projects.permissions import MANAGE, VIEW
from hierarchy_server.apps.projects.schemas.projects import (
    HierarchyCapabilities,
    HierarchyCreate,
    HierarchyHistory,
    HierarchyPage,
    HierarchyProject,
    HierarchyRestore,
    HierarchySave,
)
from hierarchy_server.apps.projects.services.projects import ProjectService
from hierarchy_server.container import Container
from hierarchy_server.deps import get_container, get_idempotency_key, require
from hierarchy_server.settings import API_PREFIX
from lib.auth.context import CallerContext
from lib.web.response import ApiResponse, ok

router = APIRouter(prefix=API_PREFIX, tags=["层级图"])
Reader = Annotated[CallerContext, Depends(require(VIEW))]
Writer = Annotated[CallerContext, Depends(require(MANAGE))]


def get_service(
    container: Annotated[Container, Depends(get_container)],
) -> ProjectService:
    return ProjectService(container.database, container.idempotency)


Service = Annotated[ProjectService, Depends(get_service)]


@router.get("/capabilities", response_model=ApiResponse[HierarchyCapabilities])
async def capabilities(_caller: Reader) -> ApiResponse[HierarchyCapabilities]:
    return ok(
        HierarchyCapabilities(
            is_enabled=True, max_nodes=300, max_edges=2000, history_limit=50
        )
    )


@router.get("/projects", response_model=ApiResponse[HierarchyPage])
async def list_projects(
    service: Service,
    caller: Reader,
    page: Annotated[int, Query(ge=1, le=100000)] = 1,
    size: Annotated[int, Query(ge=1, le=200)] = 20,
    q: Annotated[str, Query(max_length=80)] = "",
) -> ApiResponse[HierarchyPage]:
    return ok(await service.list(caller.user_id, q, (page, size)))


@router.get(
    "/projects/{project_id}", response_model=ApiResponse[HierarchyProject]
)
async def get_project(
    project_id: UUID, service: Service, caller: Reader
) -> ApiResponse[HierarchyProject]:
    return ok(await service.get(caller.user_id, project_id))


@router.post(
    "/projects", status_code=201, response_model=ApiResponse[HierarchyProject]
)
async def create_project(
    body: HierarchyCreate,
    response: Response,
    service: Service,
    caller: Writer,
    key: Annotated[str | None, Depends(get_idempotency_key)],
) -> ApiResponse[HierarchyProject]:
    project = await service.create(caller.user_id, body.document, key)
    response.headers["Location"] = f"{API_PREFIX}/projects/{project.id}"
    return ok(project)


@router.put(
    "/projects/{project_id}", response_model=ApiResponse[HierarchyProject]
)
async def save_project(
    project_id: UUID, body: HierarchySave, service: Service, caller: Writer
) -> ApiResponse[HierarchyProject]:
    return ok(await service.save(caller.user_id, project_id, body))


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(
    project_id: UUID, service: Service, caller: Writer
) -> Response:
    await service.delete(caller.user_id, project_id)
    return Response(status_code=204)


@router.get(
    "/projects/{project_id}/versions",
    response_model=ApiResponse[HierarchyHistory],
)
async def history(
    project_id: UUID,
    service: Service,
    caller: Reader,
    after: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 50,
) -> ApiResponse[HierarchyHistory]:
    return ok(await service.history(caller.user_id, project_id, after, limit))


@router.post(
    "/projects/{project_id}:restore",
    response_model=ApiResponse[HierarchyProject],
)
async def restore(
    project_id: UUID, body: HierarchyRestore, service: Service, caller: Writer
) -> ApiResponse[HierarchyProject]:
    return ok(await service.restore(caller.user_id, project_id, body))
