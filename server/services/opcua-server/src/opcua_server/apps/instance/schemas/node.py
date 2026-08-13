"""节点面的入参与出参。

⚠ `initial_value` 是**初值**（配置），`value` 是**当前值**（运行时内存）。
两者不是一回事：当前值不落库，进程重启后所有节点回到初值（不变式 1、2）。
出参把它们并列，是为了不让人以为读到的当前值将来还在。
"""

import uuid
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from opcua_server.apps.instance.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)

# ⚠ 与 models/node.py 的 NODE_CLASSES / IDENTIFIER_KINDS / DATA_TYPES 逐字一致，
# 由契约测试钉死。理由同 schemas/instance.py 里的说明。
NodeClass = Literal["object", "variable", "property", "method"]
IdentifierKind = Literal["numeric", "string"]
DataType = Literal[
    "boolean",
    "sbyte",
    "byte",
    "int16",
    "uint16",
    "int32",
    "uint32",
    "int64",
    "uint64",
    "float",
    "double",
    "string",
    "datetime",
    "guid",
    "byte_string",
]

Identifier = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]
BrowseName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]
NodeDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=255)
]

# OPC UA ValueRank：-3 标量或一维 / -2 任意 / -1 标量 / 0 一维以上 / n 固定维数
VALUE_RANK_MIN = -3
ACCESS_LEVEL_MIN = 0
ACCESS_LEVEL_MAX = 255


class NodeOut(OutputModel):
    """节点定义。"""

    id: uuid.UUID
    instance_id: uuid.UUID
    parent_id: uuid.UUID | None = None
    browse_name: str
    node_class: str
    identifier: str
    identifier_kind: str
    # 完整 NodeId，命名空间索引由系统钉死为 2（不变式 4）
    node_id: str
    data_type: str | None = None
    value_rank: int
    array_dimensions: list[int] | None = None
    access_level: int
    initial_value: object | None = None
    description: str | None = None
    created_at: Utc
    updated_at: Utc


class NodeValueOut(OutputModel):
    """节点的当前值。

    ⚠ `is_live` 为假表示实例没在跑，此时读到的是**初值**而不是运行时的值。
    不标注这一点，调用方会把配置当成现场读数。
    """

    identifier: str
    node_id: str
    value: object | None = None
    data_type: str | None = None
    is_live: bool


class NodeCreateIn(InputModel):
    """建节点。

    ⚠ `identifier` 由人指定且**永不自动改写**（不变式 3）：上位系统的组态
    硬编码着 NodeId，服务端替它换一个，现场所有组态一起废。冲突只报错。
    """

    identifier: Identifier
    identifier_kind: IdentifierKind = "string"
    browse_name: BrowseName
    node_class: NodeClass = "variable"
    parent_id: uuid.UUID | None = None
    data_type: DataType | None = None
    value_rank: int = Field(default=-1, ge=VALUE_RANK_MIN)
    array_dimensions: list[int] | None = None
    access_level: int = Field(
        default=1, ge=ACCESS_LEVEL_MIN, le=ACCESS_LEVEL_MAX
    )
    initial_value: object | None = None
    description: NodeDescription | None = None


class NodeUpdateIn(InputModel):
    """改节点定义。

    ⚠ 这里没有 `identifier`——它不可改（不变式 3）。要换标识只能删了重建，
    而那是一个现场必须同步改组态的动作，不该伪装成一次改名。
    ⚠ `browse_name` 与 `data_type` 属于待重启档：保存成功但要重启才生效。
    ⚠ `access_level` 是热生效档：实例在跑就当场改运行中地址空间的可写位；
    热改失败时转待重启，并计入出参的 `pending_fields`。
    """

    browse_name: BrowseName | None = None
    data_type: DataType | None = None
    access_level: int | None = Field(
        default=None, ge=ACCESS_LEVEL_MIN, le=ACCESS_LEVEL_MAX
    )
    initial_value: object | None = None
    description: NodeDescription | None = None


class NodeWriteIn(InputModel):
    """向节点写值。

    ⚠ 只改运行时内存，**不写库**。重启后回到初值，这是明确语义。
    """

    value: object


class NodeWriteOut(OutputModel):
    """写值结果。`value` 是按数据类型收敛之后的实际值。"""

    identifier: str
    node_id: str
    value: object | None = None


class NodeMutationOut(OutputModel):
    """节点增删改的结果，并回答本次哪些改动尚未生效。"""

    node: NodeOut
    pending_fields: list[str] = Field(default_factory=list[str])
