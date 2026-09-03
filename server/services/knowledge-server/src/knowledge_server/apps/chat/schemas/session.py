"""会话面的入参与出参。

⚠ 范围这一格入参与出参**形状不同**，是有意的：写的时候只报 id
（`base_scope_ids`），读的时候要连库名一起（`base_scope`）——只回一串 uuid 的话，
前端要么自己再查一遍，要么显示不出人话，而库被删之后它连「这一条是什么」
都答不上来。
"""

import uuid
from typing import Annotated, Any, ClassVar

from pydantic import AfterValidator, Field, StringConstraints

from knowledge_server.apps.chat.schemas.common import (
    InputModel,
    OutputModel,
    UpdateModel,
    Utc,
)

# 与 `kb_chat_sessions` 的列宽逐字对齐；两边漂开的表现是入参放行、写库时才炸
TITLE_MAX_LENGTH = 200

# 一次最多把范围收到几个库。⚠ 有上限：范围要跟着提示词发给模型，
# 几百个库名会把常驻段挤没
SCOPE_MAX_BASES = 20


# ⚠ 空串是合法标题：摘不出摘要时由界面显示时刻，那是「还没有标题」而不是错
Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=TITLE_MAX_LENGTH),
]


def _rejecting_empty(given: list[uuid.UUID]) -> list[uuid.UUID]:
    """空表当场拒。

    ⚠ 「一个都没选」不许被当成「不限库」：静默放行的表现是用户清空了选择，
    而检索悄悄扩到了他刚排除掉的那些库。不限库要显式给 `null`。

    Args: given。
    """
    if not given:
        raise ValueError("范围不能是空表：不限库请把 base_scope_ids 给成 null")
    return given


# 范围里那几个库的 id。⚠ `None` = 全部知识库，空表非法
BaseScopeIds = Annotated[
    list[uuid.UUID],
    Field(max_length=SCOPE_MAX_BASES),
    AfterValidator(_rejecting_empty),
]


class ChatScopeBaseOut(OutputModel):
    """范围里的一个库。"""

    base_id: uuid.UUID
    # 库名；已经没有这个库时是空串
    name: str
    # ⚠ 库被删了也照样列出来，只标一句「已不存在」：从范围里抹掉等于替用户把
    # 边界改宽，而他从界面上看不出来
    is_missing: bool


class ChatSessionOut(OutputModel):
    """一次对话。`row_version` 让前端判断手上那份旧没旧。"""

    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    # 这次对话去哪几个库取数。⚠ `None` = 全部知识库，不是「一个都没有」
    base_scope: list[ChatScopeBaseOut] | None
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
    # 缺省 = 全部知识库。给了就逐个校验存在性，认不出整笔拒
    base_scope_ids: BaseScopeIds | None = None


class ChatSessionUpdateIn(UpdateModel):
    """改会话。缺省的字段表示本次不涉及。"""

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {"title", "is_archived", "expected_version"}
    )

    title: Title | None = None
    # 归档只是不再默认列出，历史一条都不删
    is_archived: bool | None = None
    # ⚠ 这一格上的 `null` 是「改回全部知识库」，与缺省（本次不涉及）不同
    base_scope_ids: BaseScopeIds | None = None
    # 手上那份的行版本；给了就断言，对不上回 409。⚠ 可省是有意的：改标题那条路
    # 本来就是无条件覆盖，为它强行加一格会把既有客户端一次性打断
    expected_version: int | None = Field(default=None, ge=1)
