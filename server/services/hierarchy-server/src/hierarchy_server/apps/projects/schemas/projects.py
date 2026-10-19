"""层级图项目、保存与历史版本的对外形状。"""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, PlainSerializer, WithJsonSchema

from hierarchy_server.apps.projects.schemas.graph import HierarchyDocument
from lib.utils.timeutils import format_rfc3339

MAX_REVISION: int = 2147483647
Utc = Annotated[
    datetime,
    PlainSerializer(format_rfc3339, return_type=str),
    WithJsonSchema({"type": "string", "format": "date-time"}),
]


class HierarchyCreate(BaseModel):
    document: HierarchyDocument


class HierarchySave(HierarchyCreate):
    revision: int = Field(ge=1, le=MAX_REVISION - 1, strict=True)


class HierarchyRestore(BaseModel):
    revision: int = Field(ge=1, le=MAX_REVISION - 1, strict=True)
    target_revision: int = Field(ge=1, le=MAX_REVISION, strict=True)


class HierarchySummary(BaseModel):
    id: UUID
    title: str
    revision: int
    node_count: int
    updated_at: Utc


class HierarchyProject(HierarchySummary):
    document: HierarchyDocument


class HierarchyPage(BaseModel):
    items: list[HierarchySummary]
    page: int
    size: int
    total: int


class HierarchyVersion(BaseModel):
    revision: int
    created_at: Utc


class HierarchyHistory(BaseModel):
    items: list[HierarchyVersion]
    next: str | None
    has_more: bool


class HierarchyCapabilities(BaseModel):
    is_enabled: bool
    max_nodes: int
    max_edges: int
    history_limit: int
