"""会话面的入参与出参。ORM 模型绝不直接返给 HTTP 层。"""

import uuid
from typing import Annotated, Any, ClassVar

from pydantic import AfterValidator, Field, StringConstraints, WithJsonSchema

from ai_assistant.apps.chat.enums import SURFACE_KINDS
from ai_assistant.apps.chat.schemas.common import (
    InputModel,
    OutputModel,
    UpdateModel,
    Utc,
)

# 与 `chat_sessions` 的列宽逐字对齐；两边漂开的表现是入参放行、写库时才炸，
# 而报出来的是一句 22001，看不出是哪个字段。由单元用例钉住不许漂
TITLE_MAX_LENGTH = 200
SURFACE_REF_MAX_LENGTH = 128


def _known_surface_kind(value: str) -> str:
    """把工作面收在闭合集合里。

    Args: value。
    """
    if value not in SURFACE_KINDS:
        raise ValueError(f"未登记的工作面：{value}")
    return value


# ⚠ `WithJsonSchema` 里必须摊出取值：闭合集合只写在校验器里的话，openapi 里
# 它就是裸 `string`，前端由它生成的类型于是允许任意字符串，工作面拼错一个字
# 要到运行期才发现
SurfaceKind = Annotated[
    str,
    AfterValidator(_known_surface_kind),
    WithJsonSchema({"type": "string", "enum": list(SURFACE_KINDS)}),
]
# 工作面指向的那个东西的 id。形态随工作面变，故只限长不限字符集
SurfaceRef = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=SURFACE_REF_MAX_LENGTH,
    ),
]
# ⚠ 空串是合法标题：摘不出摘要时由界面显示时刻，那是「还没有标题」而不是错
Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=TITLE_MAX_LENGTH),
]


class SessionOut(OutputModel):
    """一次对话。`row_version` 让前端判断手上那份旧没旧。"""

    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    surface_kind: str
    surface_ref: str | None
    is_archived: bool
    row_version: int
    last_error: str | None
    created_at: Utc
    updated_at: Utc


class StepOut(OutputModel):
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


class MessageOut(OutputModel):
    """一条消息，连着它走过的那几步。"""

    id: uuid.UUID
    session_id: uuid.UUID
    seq: int
    role: str
    content_json: dict[str, Any]
    usage_json: dict[str, Any] | None
    created_at: Utc
    steps: list[StepOut] = Field(default_factory=list[StepOut])


class SessionDetailOut(SessionOut):
    """会话详情：连着全部消息与步骤，两级都按 `seq` 升序。"""

    messages: list[MessageOut] = Field(default_factory=list[MessageOut])


class SessionCreateIn(InputModel):
    """建会话。

    ⚠ 入参里没有 `user_id`：归属钉在调用者身上。开一个字段让客户端指定归属，
    就是一条替别人建会话的越权入口。
    """

    surface_kind: SurfaceKind
    surface_ref: SurfaceRef | None = None
    title: Title = ""


class SessionUpdateIn(UpdateModel):
    """改会话。缺省的字段表示本次不涉及。"""

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset({"title", "is_archived"})

    title: Title | None = None
    # 归档只是不再默认列出，历史一条都不删
    is_archived: bool | None = None
