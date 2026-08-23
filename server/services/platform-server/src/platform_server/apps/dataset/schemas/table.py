"""台账面的入参与出参。ORM 模型绝不直接返给 HTTP 层。"""

import uuid

from pydantic import Field

from platform_server.apps.dataset.models import (
    MAX_INTERVAL_MS,
    MIN_INTERVAL_MS,
)
from platform_server.apps.dataset.protocols import CollectMode
from platform_server.apps.dataset.schemas.column import ColumnOut
from platform_server.apps.dataset.schemas.common import (
    InputModel,
    Label,
    Note,
    OutputModel,
    TableCode,
    UpdateModel,
    Utc,
)

# 出厂周期：一分钟一行，一天 1440 行
DEFAULT_INTERVAL_MS = 60_000


class TableSummaryOut(OutputModel):
    """列表页的台账条目：带列数，不带整份列定义。"""

    id: uuid.UUID
    code: str
    name: str
    description: str | None
    collect_mode: CollectMode
    collect_interval_ms: int
    # 空表示永久保留
    retention_days: int | None
    # 采集器水位 = 已算完的最后一个桶的起点。⚠ 一根点位列都没绑的 aggregate
    # 台账水位恒为 null：那不是「没在采」，是「等着有人把列配上」（§12.3）
    last_collected_ts: Utc | None
    is_enabled: bool
    column_count: int
    created_at: Utc
    updated_at: Utc


class TableOut(TableSummaryOut):
    """台账详情：连列定义一起给，详情页一次请求就能画出表头。"""

    columns: list[ColumnOut]


class TableCreateIn(InputModel):
    """新建一张台账。"""

    code: TableCode
    name: Label
    description: Note | None = None
    collect_mode: CollectMode = "manual"
    collect_interval_ms: int = Field(
        default=DEFAULT_INTERVAL_MS, ge=MIN_INTERVAL_MS, le=MAX_INTERVAL_MS
    )
    retention_days: int | None = Field(default=None, ge=1)
    is_enabled: bool = True


class TableUpdateIn(UpdateModel):
    """改台账。缺省的字段不动。

    ⚠ `code` 不在这里：它是大屏绑定键 `ds:{code}:{列key}` 的前半段，改一次
    等于让每一处引用它的绑定悄悄失效。要换编码就新建一张。
    """

    NON_NULLABLE = frozenset(
        {"name", "collect_mode", "collect_interval_ms", "is_enabled"}
    )

    name: Label | None = None
    description: Note | None = None
    collect_mode: CollectMode | None = None
    collect_interval_ms: int | None = Field(
        default=None, ge=MIN_INTERVAL_MS, le=MAX_INTERVAL_MS
    )
    # 给 null 是改回永久保留，不给是不动
    retention_days: int | None = Field(default=None, ge=1)
    is_enabled: bool | None = None
