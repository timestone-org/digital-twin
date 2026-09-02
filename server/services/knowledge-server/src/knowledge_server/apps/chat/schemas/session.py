"""会话面的入参与出参。"""

import uuid
from typing import Annotated, Any, ClassVar

from pydantic import Field, StringConstraints

from knowledge_server.apps.chat.schemas.common import (
    InputModel,
    OutputModel,
    UpdateModel,
    Utc,
)

# 与 `kb_chat_sessions` 的列宽逐字对齐；两边漂开的表现是入参放行、写库时才炸
TITLE_MAX_LENGTH = 200

# ⚠ 空串是合法标题：摘不出摘要时由界面显示时刻，那是「还没有标题」而不是错
Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=TITLE_MAX_LENGTH),
]


class ChatSessionOut(OutputModel):
    """一次对话。`row_version` 让前端判断手上那份旧没旧。"""

    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    is_archived: bool
    row_version: int
    last_error: str | None
    created_at: Utc
    updated_at: Utc


class ChatStepOut(OutputModel):
    """回合里的一步：一次模型调用或一次工具执行。"""

    id: uuid.UUID
    message_id: uuid.UUID
    seq: int
    kind: str
    name: str
    state: str
    input_json: dict[str, Any] | None
    output_json: dict[str, Any] | None
    error: str | None
    started_at: Utc | None
    ended_at: Utc | None
    created_at: Utc


class ChatMessageOut(OutputModel):
    """一条消息，连着它走过的那几步。"""

    id: uuid.UUID
    session_id: uuid.UUID
    seq: int
    role: str
    content_json: dict[str, Any]
    usage_json: dict[str, Any] | None
    created_at: Utc
    steps: list[ChatStepOut] = Field(default_factory=list[ChatStepOut])


class ChatSessionDetailOut(ChatSessionOut):
    """会话详情：连着全部消息与步骤，两级都按 `seq` 升序。"""

    messages: list[ChatMessageOut] = Field(default_factory=list[ChatMessageOut])


class ChatSessionCreateIn(InputModel):
    """建会话。

    ⚠ 入参里没有 `user_id`：归属钉在调用者身上。开一个字段让客户端指定归属，
    就是一条替别人建会话的越权入口。
    """

    title: Title = ""


class ChatSessionUpdateIn(UpdateModel):
    """改会话。缺省的字段表示本次不涉及。"""

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset({"title", "is_archived"})

    title: Title | None = None
    # 归档只是不再默认列出，历史一条都不删
    is_archived: bool | None = None
