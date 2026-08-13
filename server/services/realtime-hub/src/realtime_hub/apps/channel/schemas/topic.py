"""内部端点的出入参。对外只有 WS，没有用户可见的读面。"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# 与模型上的列宽一致；两处不一致时，长值会过了校验却在插入时炸
TOPIC_MAX_LENGTH = 200
CODE_MAX_LENGTH = 64
PUBLISHER_MAX_LENGTH = 64


class InputModel(BaseModel):
    """入参基类：多余字段一律拒绝。

    ⚠ `extra="forbid"` 不能省：推送方把字段名拼错时要响亮失败，而不是让它
    静静地不生效——那种错误在两个服务之间要查很久。
    """

    model_config = ConfigDict(extra="forbid")


class OutputModel(BaseModel):
    """出参基类。"""

    model_config = ConfigDict(from_attributes=True)


class TopicDeclareIn(InputModel):
    """登记一个主题。"""

    topic: str = Field(min_length=1, max_length=TOPIC_MAX_LENGTH)
    # 订阅它所需的权限码。⚠ 必须存在于 auth-server 的目录，登记时校验
    required_code: str = Field(min_length=1, max_length=CODE_MAX_LENGTH)
    publisher: str = Field(min_length=1, max_length=PUBLISHER_MAX_LENGTH)


class TopicRevokeOut(OutputModel):
    """注销结果。`existed` 为假表示本来就没有——重复注销是正常路径。"""

    topic: str
    existed: bool


class PublishIn(InputModel):
    """推一条消息。"""

    topic: str = Field(min_length=1, max_length=TOPIC_MAX_LENGTH)
    # 条目由推送方合并好再给。⚠ 超过上限一律拒绝，分片是推送方的事
    items: list[dict[str, Any]]


class PublishOut(OutputModel):
    """推送结果，回给推送方本次分配到的 seq。"""

    topic: str
    seq: int
