"""项目事务、乐观版本和历史恢复。"""

import base64
import hashlib
from dataclasses import dataclass
from uuid import UUID, uuid5

from sqlalchemy.ext.asyncio import AsyncSession

from hierarchy_server.apps.projects.crud import projects as crud
from hierarchy_server.apps.projects.errors import (
    ProjectMissing,
    RevisionConflict,
)
from hierarchy_server.apps.projects.models.projects import Project
from hierarchy_server.apps.projects.schemas.graph import HierarchyDocument
from hierarchy_server.apps.projects.schemas.projects import (
    MAX_REVISION,
    HierarchyHistory,
    HierarchyPage,
    HierarchyProject,
    HierarchyRestore,
    HierarchySave,
    HierarchySummary,
    HierarchyVersion,
)
from lib.db import Database
from lib.errors import ValidationFailed
from lib.idempotency import IdempotencyStore
from lib.utils.ids import uuid7

CREATE_NAMESPACE: UUID = UUID("9bb998de-9c15-5e9e-85c5-0082658bfcca")


def present(project: Project) -> HierarchyProject:
    return HierarchyProject(
        id=project.id,
        title=project.title,
        revision=project.revision,
        node_count=project.node_count,
        updated_at=project.updated_at,
        document=HierarchyDocument.model_validate(project.document),
    )


def summary(project: Project) -> HierarchySummary:
    return HierarchySummary(
        id=project.id,
        title=project.title,
        revision=project.revision,
        node_count=project.node_count,
        updated_at=project.updated_at,
    )


def decode_cursor(cursor: str | None) -> int | None:
    """读取有界版本游标。Args: cursor。"""
    if cursor is None:
        return None
    try:
        prefix, revision = (
            base64.b64decode(cursor, validate=True).decode("ascii").split(":")
        )
        if prefix == "revision" and 0 < int(revision) <= MAX_REVISION:
            return int(revision)
    except (ValueError, UnicodeError):
        pass
    raise ValidationFailed("历史游标无效")


async def require_project(
    session: AsyncSession, owner: UUID, project_id: UUID
) -> Project:
    project = await crud.find_project(session, owner, project_id)
    if project is None:
        raise ProjectMissing("项目不存在或不可访问")
    return project


@dataclass(frozen=True)
class ProjectService:
    database: Database
    idempotency: IdempotencyStore

    async def list(
        self, owner: UUID, query: str, window: tuple[int, int]
    ) -> HierarchyPage:
        async with self.database.session() as session:
            projects, total = await crud.list_projects(
                session, owner, query, window
            )
            return HierarchyPage(
                items=[summary(project) for project in projects],
                total=total,
                page=window[0],
                size=window[1],
            )

    async def get(self, owner: UUID, project_id: UUID) -> HierarchyProject:
        async with self.database.session() as session:
            return present(await require_project(session, owner, project_id))

    async def create(
        self, owner: UUID, document: HierarchyDocument, key: str | None
    ) -> HierarchyProject:
        """提交成功后才缓存创建回执。Args: owner, document, key。"""

        async def action() -> HierarchyProject:
            return await self._create(owner, document, key)

        return await self.idempotency.run_once(
            endpoint="projects.create",
            key=key,
            caller=owner,
            model=HierarchyProject,
            action=action,
        )

    async def _create(
        self, owner: UUID, document: HierarchyDocument, key: str | None
    ) -> HierarchyProject:
        project_id = (
            uuid7()
            if key is None
            else uuid5(CREATE_NAMESPACE, f"{owner}:{key}")
        )
        digest = hashlib.sha256(
            document.model_dump_json(by_alias=True).encode()
        ).hexdigest()
        async with self.database.session() as session:
            inserted = await crud.insert_project(
                session,
                {
                    "id": project_id,
                    "owner_id": owner,
                    "title": document.title,
                    "revision": 1,
                    "node_count": sum(
                        node.kind == "meter" for node in document.nodes
                    ),
                    "document": document.model_dump(mode="json", by_alias=True),
                    "creation_hash": digest,
                },
            )
            project = await require_project(session, owner, project_id)
            if project.creation_hash != digest:
                raise RevisionConflict("同一个幂等键不能用于不同的项目内容")
            if inserted:
                await crud.append_version(session, project)
            # ⚠ 数据库提交后缓存失败时，稳定 ID 与首次内容摘要避免再次创建项目。
            return HierarchyProject(
                id=project.id,
                title=document.title,
                revision=1,
                node_count=sum(node.kind == "meter" for node in document.nodes),
                updated_at=project.created_at,
                document=document,
            )

    async def save(
        self, owner: UUID, project_id: UUID, change: HierarchySave
    ) -> HierarchyProject:
        async with self.database.session() as session:
            project = await require_project(session, owner, project_id)
            return await self._replace(session, project, change)

    async def _replace(
        self, session: AsyncSession, project: Project, change: HierarchySave
    ) -> HierarchyProject:
        document = change.document
        updated = await crud.replace_project(
            session,
            project,
            change.revision,
            {
                "title": document.title,
                "document": document.model_dump(mode="json", by_alias=True),
                "revision": change.revision + 1,
                "node_count": sum(
                    node.kind == "meter" for node in document.nodes
                ),
            },
        )
        if not updated:
            raise RevisionConflict(
                "项目已在其他窗口更新，请保留草稿并重新打开项目"
            )
        await session.refresh(project)
        await crud.append_version(session, project)
        return present(project)

    async def delete(self, owner: UUID, project_id: UUID) -> None:
        async with self.database.session() as session:
            await crud.remove_project(session, owner, project_id)

    async def history(
        self, owner: UUID, project_id: UUID, cursor: str | None, limit: int
    ) -> HierarchyHistory:
        before = decode_cursor(cursor)
        async with self.database.session() as session:
            await require_project(session, owner, project_id)
            versions = await crud.list_versions(
                session, project_id, before, limit
            )
            more = len(versions) > limit
            items = [
                HierarchyVersion(
                    revision=version.revision, created_at=version.created_at
                )
                for version in versions[:limit]
            ]
            token = (
                base64.b64encode(
                    f"revision:{items[-1].revision}".encode()
                ).decode()
                if more
                else None
            )
            return HierarchyHistory(items=items, next=token, has_more=more)

    async def restore(
        self, owner: UUID, project_id: UUID, change: HierarchyRestore
    ) -> HierarchyProject:
        async with self.database.session() as session:
            project = await require_project(session, owner, project_id)
            version = await crud.find_version(
                session, project_id, change.target_revision
            )
            if version is None:
                raise ProjectMissing("该历史版本已不存在")
            document = HierarchyDocument.model_validate(version.document)
            return await self._replace(
                session,
                project,
                HierarchySave(revision=change.revision, document=document),
            )
