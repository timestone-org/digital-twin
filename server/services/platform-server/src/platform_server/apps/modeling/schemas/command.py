"""建模持久命令的操作选择和查询回执。"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, JsonValue

from lib.web.response import FieldErrorOut

CommandOperation = Literal[
    "create_instance",
    "configure_instance",
    "train_instance",
    "publish_version",
    "deploy_instance",
    "create_deployment",
    "update_deployment",
    "archive_instance",
    "restore_instance",
    "archive_version",
    "restore_version",
    "switch_deployment",
    "rollback_deployment",
    "update_version",
    "retire_version",
    "delete_deployment",
    "cancel_run",
]
CommandState = Literal["pending", "unknown", "succeeded", "failed"]


class CommandFailureOut(BaseModel):
    code: int
    message: str
    details: list[FieldErrorOut]


class CommandResourceOut(BaseModel):
    id: uuid.UUID


class ModelingCommandOut(BaseModel):
    id: uuid.UUID
    operation: CommandOperation
    resource_id: uuid.UUID | None
    state: CommandState
    http_status: int | None
    result: dict[str, JsonValue] | None
    error: CommandFailureOut | None
    created_at: datetime
    completed_at: datetime | None
    trace_id: str
    is_verification_required: bool
