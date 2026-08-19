"""匿名授权面的出入参。只在内部端点上用。

⚠ 入参收的是**指纹不是票据**：票据是一枚可直接使用的凭据，让它经过这条
内部调用就等于在两个服务的日志与内存里各留一份（`models/grant.py`）。
"""

from pydantic import Field

from realtime_hub.apps.channel.schemas.topic import (
    PUBLISHER_MAX_LENGTH,
    TOPIC_MAX_LENGTH,
    InputModel,
    OutputModel,
)

# SHA-256 的十六进制串，长度与形状都钉死：收到别的形状说明推送方那边换了
# 算法，而那种漂移的表现是所有公开链接一律订不上
TICKET_HASH_LENGTH = 64
TICKET_HASH_PATTERN = r"^[0-9a-f]{64}$"


class PublicGrantDeclareIn(InputModel):
    """登记一枚票据对某个主题的匿名订阅授权。"""

    ticket_hash: str = Field(
        min_length=TICKET_HASH_LENGTH,
        max_length=TICKET_HASH_LENGTH,
        pattern=TICKET_HASH_PATTERN,
    )
    topic: str = Field(min_length=1, max_length=TOPIC_MAX_LENGTH)
    publisher: str = Field(min_length=1, max_length=PUBLISHER_MAX_LENGTH)


class PublicGrantListOut(OutputModel):
    """某个推送方名下的全部授权指纹。对账用，不分页。"""

    publisher: str
    ticket_hashes: list[str]


class PublicGrantRevokeOut(OutputModel):
    """注销结果。`is_removed` 为假表示本来就没有——重复注销是正常路径。"""

    ticket_hash: str
    is_removed: bool
