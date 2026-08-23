"""列面的入参与出参。ORM 模型绝不直接返给 HTTP 层。"""

import uuid
from typing import Any

from pydantic import Field

from platform_server.apps.dataset.models import (
    MAX_DECIMALS,
    MAX_FORMULA_LENGTH,
)
from platform_server.apps.dataset.protocols import (
    AggFunc,
    ColumnSource,
    ColumnType,
)
from platform_server.apps.dataset.schemas.common import (
    ColumnKey,
    InputModel,
    Label,
    NodeKey,
    OutputModel,
    Unit,
    UpdateModel,
    Utc,
)

# 一次重排最多收多少个列 id。⚠ 有上限不是省流量：这是个无界数组入参
MAX_REORDER_IDS = 500


class ColumnOut(OutputModel):
    """一列的对外形态。"""

    id: uuid.UUID
    table_id: uuid.UUID
    key: str
    name: str
    unit: str | None
    decimals: int | None
    data_type: ColumnType
    source: ColumnSource
    agg: AggFunc
    node_key: str | None
    formula: str | None
    # 保存公式时解析出的依赖。⚠ 公式引擎随第 2 期落地，在那之前恒为 null
    formula_deps: list[str] | None
    order_index: int
    is_required: bool
    default_value: Any
    created_at: Utc
    updated_at: Utc


class ColumnCreateIn(InputModel):
    """新增一列。`order_index` 缺省表示排到最后。"""

    key: ColumnKey
    name: Label
    unit: Unit | None = None
    decimals: int | None = Field(default=None, ge=0, le=MAX_DECIMALS)
    data_type: ColumnType = "number"
    source: ColumnSource = "manual"
    agg: AggFunc = "avg"
    node_key: NodeKey | None = None
    formula: str | None = Field(default=None, max_length=MAX_FORMULA_LENGTH)
    order_index: int | None = Field(default=None, ge=0)
    is_required: bool = False
    default_value: Any = None


class ColumnUpdateIn(UpdateModel):
    """改一列。缺省的字段不动。

    ⚠ `key` 不在这里：它是 JSONB 里的字段名，改一次等于让这一列的历史值集体
    失联，而每一行看起来都还在（docs/DATASET_DESIGN.md §4.2）。
    """

    NON_NULLABLE = frozenset(
        {
            "name",
            "data_type",
            "source",
            "agg",
            "order_index",
            "is_required",
        }
    )

    name: Label | None = None
    unit: Unit | None = None
    decimals: int | None = Field(default=None, ge=0, le=MAX_DECIMALS)
    data_type: ColumnType | None = None
    source: ColumnSource | None = None
    agg: AggFunc | None = None
    node_key: NodeKey | None = None
    formula: str | None = Field(default=None, max_length=MAX_FORMULA_LENGTH)
    order_index: int | None = Field(default=None, ge=0)
    is_required: bool | None = None
    default_value: Any = None


class ColumnReorderIn(InputModel):
    """整体重排：给全套列 id 的目标顺序。

    ⚠ 不在名单里的列**静默保持原样**，不报错也不排到最前：并发编辑时另一个人
    刚加的列不该因为这次重排而消失在列表顶端。
    """

    column_ids: list[uuid.UUID] = Field(max_length=MAX_REORDER_IDS)
