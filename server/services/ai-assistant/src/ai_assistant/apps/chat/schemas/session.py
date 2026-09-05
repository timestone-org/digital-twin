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
from ai_assistant.settings import REASONING_EFFORTS

# 与 `chat_sessions` 的列宽逐字对齐；两边漂开的表现是入参放行、写库时才炸，
# 而报出来的是一句 22001，看不出是哪个字段。由单元用例钉住不许漂
TITLE_MAX_LENGTH = 200
SURFACE_REF_MAX_LENGTH = 128
# 档位名的长度只是一道防荒唐的闸，不是取值范围：档位就是供应商（ADR-0040），
# 认不认得这一路要问此刻的注册表，而那是部署期的数据，不是代码里的集合
PROFILE_MAX_LENGTH = 128


def _known_surface_kind(value: str) -> str:
    """把工作面收在闭合集合里。

    Args: value。
    """
    if value not in SURFACE_KINDS:
        raise ValueError(f"未登记的工作面：{value}")
    return value


def _known_effort(value: str) -> str:
    """未登记的推理档位一律拒。

    Args: value。
    """
    if value not in REASONING_EFFORTS:
        raise ValueError(f"未登记的推理档位：{value}")
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
    # 这个会话走哪一路模型、哪一档。建会话时就盖上了此刻的默认，
    # `None` 只会出现在建行时还没盖默认的旧行上
    model_profile: str | None = None
    reasoning_effort: str | None = None
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
    # 当前执行计划（ADR-0024）。前端重开面板时靠它恢复计划清单
    plan_json: dict[str, Any] | None = None


# ⚠ 这里**不摊取值**，与工作面那一条相反：档位就是那一路供应商，而供应商是
# 库里的行，随部署配置增减。摊进 openapi 的话，前端生成的类型会把「这套部署
# 配了哪几路」钉死成编译期的字面量集合，改一次配置就得重新生成一次类型。
# 认不认得这一路由服务层问注册表（`session_service.update_session`）
ModelProfileName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=PROFILE_MAX_LENGTH
    ),
]
ReasoningEffort = Annotated[
    str,
    AfterValidator(_known_effort),
    WithJsonSchema({"type": "string", "enum": list(REASONING_EFFORTS)}),
]


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
    # 换模型是**会话级**的选择：工具回填那几次推进是循环自己发的，
    # 那时前端手上没有用户的选择，只有落在会话上才带得过去
    model_profile: ModelProfileName | None = None
    reasoning_effort: ReasoningEffort | None = None
