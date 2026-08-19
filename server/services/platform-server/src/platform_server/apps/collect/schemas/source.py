"""数据源面的入参与出参。ORM 模型绝不直接返给 HTTP 层。"""

import uuid
from typing import Any

from pydantic import Field, SecretStr

from collectwire import DataType
from platform_server.apps.collect.models import MIN_INTERVAL_MS
from platform_server.apps.collect.protocols import Protocol, ReadMode
from platform_server.apps.collect.schemas.common import (
    Address,
    Code,
    InputModel,
    Label,
    Note,
    OutputModel,
    UpdateModel,
    Utc,
)

# 连接参数的条数上限：它是给驱动的旁路配置，不是任意 KV 存储
MAX_OPTIONS = 32


class SourceRuntimeOut(OutputModel):
    """一个数据源此刻的采集运行态：collector 写、平台只读。

    ⚠ 与 `is_enabled` 不是一回事：前者是「配置说它该采」，这里是「它此刻真
    在采吗」。把两者显示成同一个状态灯，是现场最常见的一种误判。
    """

    # `connecting` / `online` / `offline`，外加平台侧的 `unknown`
    # （采集侧还没写过这一行，通常意味着 collector 没起来）
    state: str
    # 采集侧此刻真的挂着的点位数。与 `SourceOut.point_count`（配置了多少个）
    # 对不上时，差额就是没订上的那些
    point_count: int
    # `transient` / `config` / `auth`，没有错就是 null
    error_category: str | None
    # 异常类型名，不是异常原文——原文可能带凭据与请求体
    error_detail: str | None
    leader_instance: str | None
    updated_at: Utc | None


class SourceOut(OutputModel):
    """一个数据源。

    ⚠ 没有凭据字段：口令只进 `credential_enc`，任何出参都不回它。
    `has_credential` 只说「配没配过」，够界面判断了。
    """

    id: uuid.UUID
    name: str
    code: str
    description: str | None
    protocol: Protocol
    endpoint: str
    # 连接现场设备的账号名。⚠ 只回账号名，口令任何出参都不回
    username: str | None
    has_credential: bool
    options_json: dict[str, str]
    read_mode: ReadMode
    poll_interval_ms: int
    is_enabled: bool
    point_count: int
    # 实时值最多覆盖多少个点位。⚠ 由服务端回而不是前端写死一份：两处各写一个
    # 数字，调大配置之后界面还在按旧数字提示「只覆盖前 N 个」
    live_point_limit: int
    runtime: SourceRuntimeOut
    created_at: Utc
    updated_at: Utc


class SourceCreateIn(InputModel):
    """新建一个数据源。"""

    name: Label
    code: Code
    description: Note | None = None
    protocol: Protocol
    endpoint: Address
    username: Label | None = None
    # ⚠ SecretStr：口令要经过日志、校验错误、异常三条路，裸 str 早晚被打出去
    credential: SecretStr | None = None
    options_json: dict[str, str] = Field(
        default_factory=dict[str, str], max_length=MAX_OPTIONS
    )
    read_mode: ReadMode = "subscribe"
    poll_interval_ms: int = Field(default=1000, ge=MIN_INTERVAL_MS)
    is_enabled: bool = True


class SourceUpdateIn(UpdateModel):
    """改数据源。缺省的字段不动。

    ⚠ `code` 不在这里：编码是数据源的身份，改名等于换身份，历史会断成两段
    （docs/COLLECT_DESIGN.md §2）。要换名字就新建一个。
    """

    NON_NULLABLE = frozenset(
        {
            "name",
            "endpoint",
            "options_json",
            "read_mode",
            "poll_interval_ms",
            "is_enabled",
        }
    )

    name: Label | None = None
    description: Note | None = None
    endpoint: Address | None = None
    # 账号名给 null 是清空（改回匿名连接），不给是不动
    username: Label | None = None
    credential: SecretStr | None = None
    options_json: dict[str, str] | None = Field(
        default=None, max_length=MAX_OPTIONS
    )
    read_mode: ReadMode | None = None
    poll_interval_ms: int | None = Field(default=None, ge=MIN_INTERVAL_MS)
    is_enabled: bool | None = None


class BrowseItemOut(OutputModel):
    """地址空间里的一项。`address` 可直接填进点位配置。"""

    address: str
    name: str
    has_children: bool
    # 只有变量节点能当点位；对象节点只用来往下走
    is_variable: bool
    # ⚠ `null` 是「现场没读到」，不是「不是数」：建点位时按它预选类型，
    # 读不到就让人自己选。兜一个 float 会让文本点位按数值聚合
    data_type: DataType | None = None


class BrowseIn(InputModel):
    """一次地址空间浏览。`parent` 缺省表示从根开始。"""

    parent: Address | None = None


class BrowseOut(OutputModel):
    """一次浏览的结果。"""

    items: list[BrowseItemOut]


class SubtreeItemOut(BrowseItemOut):
    """子树里的一项，外加它挂在谁下面。

    ⚠ `parent` 不能省：整棵子树是平铺回来的，客户端要靠它拼回层级。
    """

    parent: str | None


class SubtreeOut(OutputModel):
    """一次子树遍历的结果。

    ⚠ 不限条数：勾一个通道要的就是它下面的全部点位。唯一的约束是这次请求的
    时间预算，到点没走完才置 `is_truncated`。
    ⚠ `is_truncated` 为真时**必须**在界面上说出来：不说的话用户会把
    「只收到一半」当成「这个通道就这么多点位」。
    """

    items: list[SubtreeItemOut]
    is_truncated: bool


class ConnectivityOut(OutputModel):
    """一次连通性测试的结论。

    ⚠ `is_reachable` 为假时 `detail` 必须说清原因：把「没有活会话」与「寻址串
    写错」显示成同一句话，用户就只能挨个试。
    """

    source_id: uuid.UUID
    is_reachable: bool
    detail: str | None


class WriteIn(InputModel):
    """向现场下发一个写值。"""

    value: Any = Field(description="写下去的值，类型由点位的 data_type 决定")


class WriteOut(OutputModel):
    """一次下发的结论。"""

    point_id: uuid.UUID
    node_key: str
    is_written: bool
