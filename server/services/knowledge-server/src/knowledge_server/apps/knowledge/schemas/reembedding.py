"""管理员整库重嵌的预检、启动凭据和进度。"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

JobStatus = Literal["pending", "running", "succeeded", "failed", "cancelled"]
VectorStatus = Literal[
    "unindexed",
    "ready",
    "legacy_unverified",
    "model_unavailable",
    "space_mismatch",
]


class ReembeddingPreviewOut(BaseModel):
    target_model: str | None
    target_dimensions: int | None
    target_space_id: str | None
    content_revision: int
    total_documents: int
    total_chunks: int
    can_start: bool
    note: str


class ReembeddingStartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_space_id: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_revision: int = Field(ge=0)


class ReembeddingJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    base_id: uuid.UUID
    status: JobStatus
    target_model: str
    target_dimensions: int
    total_chunks: int
    completed_chunks: int
    created_at: datetime
    finished_at: datetime | None
    error_message: str | None
