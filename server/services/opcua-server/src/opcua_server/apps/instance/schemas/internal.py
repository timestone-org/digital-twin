"""内部端点的入参与出参：批量解析节点、批量写值。

⚠ 这一组只给**服务**用，不给浏览器用。它与 `schemas/node.py` 的区别不在字段
而在失败口径：公开面一个节点写不进就是整条请求失败，内部面**逐项回执**——
调用方一拍要写一批点位，某一个被人删了不该让另外几个也写不进去。
"""

import uuid

from pydantic import Field

from opcua_server.apps.instance.schemas.common import InputModel, OutputModel

# 一次批量的条数上限。⚠ 不是性能考虑：内部端点也要有边界，
# 无上限的批量在调用方出错时会把整个地址空间锁在一次请求里
MAX_BATCH = 200


class NodeResolveIn(InputModel):
    """按行 id 批量问一批节点的定义。"""

    instance_id: uuid.UUID
    ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_BATCH)


class NodeResolvedOut(OutputModel):
    """一个节点的定义；不存在时除 `id` 外全为空。

    ⚠ 不存在**不是错误**：调用方问的正是「它还在不在」，
    把它做成 404 会让批量里一个失效的节点毁掉整次问询。
    """

    id: uuid.UUID
    is_found: bool
    identifier: str | None = None
    node_id: str | None = None
    # ⚠ 出参用 `str` 不用 `DataType` 字面量集合，与 `NodeOut` 同口径：
    # 库里的取值由 CHECK 约束保证，出参再窄一次只会在读到历史行时炸在序列化里
    data_type: str | None = None
    is_writable: bool = False


class NodeResolveOut(OutputModel):
    """一次批量解析的结果，顺序与入参一致。"""

    instance_id: uuid.UUID
    is_running: bool
    items: list[NodeResolvedOut]


class NodeWriteItemIn(InputModel):
    """批量写值里的一项。"""

    id: uuid.UUID
    value: object


class NodeBatchWriteIn(InputModel):
    """向同一实例的一批节点写值。"""

    instance_id: uuid.UUID
    items: list[NodeWriteItemIn] = Field(min_length=1, max_length=MAX_BATCH)


class NodeWriteResultOut(OutputModel):
    """一项写值的去向。

    ⚠ `is_written` 为假时 `error` 必有内容：静默的失败项会被调用方数成成功。
    """

    id: uuid.UUID
    is_written: bool
    identifier: str | None = None
    node_id: str | None = None
    value: object | None = None
    error: str | None = None


class NodeBatchWriteOut(OutputModel):
    """一次批量写值的结果，顺序与入参一致。"""

    instance_id: uuid.UUID
    written_count: int
    items: list[NodeWriteResultOut]
