"""定时重新训练的配置与运行水位。"""

import uuid

from pydantic import AwareDatetime, Field

from platform_server.apps.modeling.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)


class ModelingScheduleIn(InputModel):
    """覆盖规则，修订号保护并发编辑。"""

    is_enabled: bool
    interval_minutes: int = Field(default=1440, ge=5, le=525600)
    should_auto_publish: bool = Field(default=False, alias="auto_publish")
    first_run_at: AwareDatetime | None = None
    expected_revision: int = Field(ge=0)


class ModelingScheduleOut(OutputModel):
    """工作流的下一次训练与最近触发结果。"""

    pipeline_id: uuid.UUID
    is_enabled: bool = False
    interval_minutes: int = 1440
    should_auto_publish: bool = Field(default=False, alias="auto_publish")
    next_run_at: Utc | None = None
    last_run_at: Utc | None = None
    last_run_id: uuid.UUID | None = None
    last_error: str | None = None
    revision: int = 0
    updated_at: Utc | None = None
