"""层级图项目与版本的属主数据访问。"""

from collections.abc import Mapping
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from hierarchy_server.apps.projects.models.projects import Project, Version

HISTORY_LIMIT: int = 50


async def find_project(
    session: AsyncSession, owner: UUID, project_id: UUID
) -> Project | None:
    return await session.scalar(
        select(Project).where(
            Project.id == project_id, Project.owner_id == owner
        )
    )


async def list_projects(
    session: AsyncSession, owner: UUID, query: str, window: tuple[int, int]
) -> tuple[list[Project], int]:
    """按账号与标题分页查询。Args: session, owner, query, window。"""
    statement = (
        select(Project)
        .options(
            load_only(
                Project.id,
                Project.title,
                Project.revision,
                Project.node_count,
                Project.updated_at,
                raiseload=True,
            )
        )
        .where(Project.owner_id == owner)
    )
    if query:
        statement = statement.where(
            Project.title.icontains(query, autoescape=True)
        )
    total = await session.scalar(
        select(func.count()).select_from(statement.subquery())
    )
    page, size = window
    result = await session.scalars(
        statement.order_by(Project.updated_at.desc(), Project.id)
        .offset((page - 1) * size)
        .limit(size)
    )
    return list(result), total or 0


async def insert_project(
    session: AsyncSession, values: Mapping[str, object]
) -> bool:
    statement = (
        insert(Project)
        .values(**values)
        .on_conflict_do_nothing(index_elements=[Project.id])
        .returning(Project.id)
    )
    return await session.scalar(statement) is not None


async def replace_project(
    session: AsyncSession,
    project: Project,
    revision: int,
    values: Mapping[str, object],
) -> bool:
    """条件更新防止并发覆盖。Args: session, project, revision, values。"""
    statement = (
        update(Project)
        .where(
            Project.id == project.id,
            Project.owner_id == project.owner_id,
            Project.revision == revision,
        )
        .values(**values)
        .returning(Project.id)
    )
    return await session.scalar(statement) is not None


async def append_version(session: AsyncSession, project: Project) -> None:
    """保存快照并裁剪历史。Args: session, project。"""
    session.add(
        Version(
            project_id=project.id,
            revision=project.revision,
            document=project.document,
        )
    )
    await session.flush()
    await session.execute(
        delete(Version).where(
            Version.project_id == project.id,
            Version.revision <= project.revision - HISTORY_LIMIT,
        )
    )


async def list_versions(
    session: AsyncSession, project_id: UUID, before: int | None, limit: int
) -> list[Version]:
    statement = select(Version).where(Version.project_id == project_id)
    if before is not None:
        statement = statement.where(Version.revision < before)
    return list(
        await session.scalars(
            statement.order_by(Version.revision.desc()).limit(limit + 1)
        )
    )


async def find_version(
    session: AsyncSession, project_id: UUID, revision: int
) -> Version | None:
    return await session.scalar(
        select(Version).where(
            Version.project_id == project_id, Version.revision == revision
        )
    )


async def remove_project(
    session: AsyncSession, owner: UUID, project_id: UUID
) -> None:
    await session.execute(
        delete(Project).where(
            Project.id == project_id, Project.owner_id == owner
        )
    )
