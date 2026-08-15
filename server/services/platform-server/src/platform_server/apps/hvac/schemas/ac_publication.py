"""预测下发面的对外模型。口径见 docs/AC_PUBLISH_DESIGN.md §8。"""

import uuid

from pydantic import Field

from platform_server.apps.hvac.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)

# 一个模型最多绑多少个组合点位。⚠ 与服务组合的上限同量级即可：
# 组合数是房间机组的子集数，六台房间满打满算 63 个
MAX_SET_BINDINGS = 64


class SetBindingIn(InputModel):
    """一个服务组合绑一个数字点位。"""

    set_key: str = Field(min_length=1, max_length=256)
    node_id: uuid.UUID


class PublicationPutIn(InputModel):
    """整份保存发布配置。

    ⚠ 整份保存不是补丁：绑定是一组必须同时成立的东西——换了实例，底下每一个
    节点 id 都得跟着换，逐字段 PATCH 会让中间态出现「节点属于旧实例」。
    """

    opcua_instance_id: uuid.UUID
    # 省略即「区域点位还没绑」。⚠ 没绑齐就不发布，这一点由页面显式说出来
    recommendation_node_id: uuid.UUID | None = None
    set_bindings: list[SetBindingIn] = Field(
        default_factory=list[SetBindingIn], max_length=MAX_SET_BINDINGS
    )
    is_enabled: bool = False


class SetBindingOut(OutputModel):
    """一个组合绑定的对外形态。

    ⚠ `is_serving` 为假表示模型改过服务组合、这条绑定落空了。绑定**留着不删**
    （改回去时还在），但必须在页面上说出来。
    """

    set_key: str
    node_id: uuid.UUID
    identifier: str
    is_serving: bool


class PublicationOut(OutputModel):
    """一个模型的发布配置与它此刻的心跳。"""

    model_id: uuid.UUID
    opcua_instance_id: uuid.UUID
    recommendation_node_id: uuid.UUID | None
    recommendation_identifier: str | None
    is_enabled: bool
    # 实例 + 区域点位 + 每一个服务组合都绑齐了才会发布
    is_fully_bound: bool
    # 还差哪几个组合没绑，set_key 升序。⚠ 必须列出来：只说「没绑齐」
    # 而不说差哪几个，用户要自己在表里逐行找
    unbound_set_keys: list[str]
    set_bindings: list[SetBindingOut]
    last_published_at: Utc | None
    last_status: str | None
    last_error: str | None


class PublishItemOut(OutputModel):
    """一次下发里一个点位的去向。"""

    # 区域推荐点位这一项为 null，组合点位为它的 set_key
    set_key: str | None
    identifier: str | None
    value: str | float | None
    is_written: bool
    error: str | None


class PublishOut(OutputModel):
    """一次下发的结果。

    ⚠ `status` 三档分开：`degraded` 是「写进去了但写的是哨兵值」，
    `failed` 是「一个字节都没写进去」——后者上位机读到的还是旧值。
    """

    model_id: uuid.UUID
    status: str
    published_at: Utc
    written_count: int
    items: list[PublishItemOut]
    error: str | None
