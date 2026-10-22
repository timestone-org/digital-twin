"""知识原块的有界正文窗口。"""

import uuid

from pydantic import BaseModel, Field

from knowledge_server.apps.knowledge.schemas.search import LocatorOut


class ChunkWindowIn(BaseModel):
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=4000, ge=1, le=8000)


class ChunkWindowOut(BaseModel):
    base_id: uuid.UUID
    chunk_id: uuid.UUID
    document_title: str
    heading_path: str
    locator: LocatorOut
    text: str
    offset: int
    total_chars: int
    has_more: bool
    next_offset: int | None
