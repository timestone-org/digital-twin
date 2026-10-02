"""只记录已有客户端调用的实际回执，不推进模型。"""

from pydantic import Field

from ai_assistant.apps.chat.schemas.advance import (
    MAX_TOOL_RESULTS,
    ToolResultIn,
)
from ai_assistant.apps.chat.schemas.common import InputModel, OutputModel


class ReceiptsIn(InputModel):
    """客户端实际执行的非空结果；未执行项不补交。"""

    tool_results: list[ToolResultIn] = Field(
        min_length=1, max_length=MAX_TOOL_RESULTS
    )


class ReceiptsOut(OutputModel):
    """已记录或同值重复的调用 id。"""

    accepted_call_ids: list[str]
