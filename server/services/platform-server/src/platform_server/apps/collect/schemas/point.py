"""点位面的入参与出参。"""

import uuid

from pydantic import Field

from collectwire import DataType
from platform_server.apps.collect.models import MIN_INTERVAL_MS
from platform_server.apps.collect.schemas.common import (
    Address,
    Code,
    InputModel,
    Label,
    OutputModel,
    UpdateModel,
    Utc,
)

# 一次批量建点的上限。⚠ 有上限不是为了省内存，是因为整批要在一次寻址串校验
# 的往返里带过去，太长会把那次往返拖过预算
MAX_BATCH = 200
# 心跳归档的默认值：稳态段每分钟至少落一条，曲线才不会断
DEFAULT_ARCHIVE_MAX_INTERVAL_MS = 60_000

# 寻址串校验的三档结论
CHECK_PASSED = "passed"
CHECK_REJECTED = "rejected"
# ⚠ 「没校验成」不许显示成「通过」：超时、采集侧离线、动作不被支持都落这一档，
# 用户看到它才知道这条寻址串还没有被现场确认过
CHECK_UNVERIFIED = "unverified"


class PointOut(OutputModel):
    """一个点位。`node_key` 是它在全系统里的身份。"""

    id: uuid.UUID
    source_id: uuid.UUID
    node_key: str
    code: str
    name: str
    address: str
    data_type: DataType
    unit: str | None
    sampling_interval_ms: int
    deadband: float
    archive_enabled: bool
    archive_max_interval_ms: int
    archive_retention_days: int | None
    created_at: Utc
    updated_at: Utc


class PointItemIn(InputModel):
    """批量里的一个点位。数据源在批的层面上给，一批只对一个源。"""

    code: Code
    name: Label
    address: Address
    data_type: DataType = "float"
    unit: str | None = Field(default=None, max_length=32)
    sampling_interval_ms: int = Field(default=1000, ge=MIN_INTERVAL_MS)
    deadband: float = Field(default=0.0, ge=0.0)
    archive_enabled: bool = True
    archive_max_interval_ms: int = Field(
        default=DEFAULT_ARCHIVE_MAX_INTERVAL_MS, gt=0
    )
    archive_retention_days: int | None = Field(default=None, gt=0)


class PointCreateIn(InputModel):
    """批量建点。

    ⚠ 一批只能对一个数据源：寻址串校验要按数据源问采集侧，混着多个源就得发
    多次往返，而其中一次超时会让这一批处于「一半校过一半没校」的状态。
    """

    source_id: uuid.UUID
    items: list[PointItemIn] = Field(min_length=1, max_length=MAX_BATCH)


class PointUpdateIn(UpdateModel):
    """改点位。缺省的字段不动。

    ⚠ `code` 不在这里：它是点位的身份，改名等于换身份，历史归旧编码
    （docs/COLLECT_DESIGN.md §2）。
    """

    NON_NULLABLE = frozenset(
        {
            "name",
            "address",
            "data_type",
            "sampling_interval_ms",
            "deadband",
            "archive_enabled",
            "archive_max_interval_ms",
        }
    )

    name: Label | None = None
    address: Address | None = None
    data_type: DataType | None = None
    unit: str | None = Field(default=None, max_length=32)
    sampling_interval_ms: int | None = Field(default=None, ge=MIN_INTERVAL_MS)
    deadband: float | None = Field(default=None, ge=0.0)
    archive_enabled: bool | None = None
    archive_max_interval_ms: int | None = Field(default=None, gt=0)
    archive_retention_days: int | None = Field(default=None, gt=0)


class AddressCheckOut(OutputModel):
    """一条寻址串在现场的校验结论。"""

    address: str
    status: str
    detail: str | None


class PointBatchOut(OutputModel):
    """一次批量建点的结果。

    ⚠ `address_checks` 每条寻址串都有一项，没结论的那些标 `unverified`：
    漏掉它们，界面就分不清「校过且没问题」与「根本没校成」。
    """

    items: list[PointOut]
    address_checks: list[AddressCheckOut]


class PointSavedOut(OutputModel):
    """一次改点位的结果，带这次寻址串校验的结论。"""

    point: PointOut
    address_check: AddressCheckOut | None
