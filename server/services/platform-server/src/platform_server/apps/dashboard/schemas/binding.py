"""绑定面的入参与出参。"""

import uuid
from typing import Any

from pydantic import Field

from platform_server.apps.dashboard.schemas.common import (
    FieldKey,
    InputModel,
    NodeKey,
    OutputModel,
    Utc,
)
from platform_server.apps.dashboard.source_kinds import SourceKind


class BindingOut(OutputModel):
    """一条绑定。id 一经创建永不改变——实时推送以它作关联键。"""

    id: uuid.UUID
    node_id: uuid.UUID
    field_key: str
    source_kind: SourceKind
    node_key: str | None
    static_value_json: Any = None
    compute_json: dict[str, Any] | None
    detail_json: dict[str, Any] | None
    transform_json: dict[str, Any] | None
    created_at: Utc
    updated_at: Utc


class BindingCreateIn(InputModel):
    """新增一条绑定。`id` 由调用方自带时用它，便于批量替换里指名道姓。"""

    id: uuid.UUID | None = None
    field_key: FieldKey
    source_kind: SourceKind
    node_key: NodeKey | None = None
    static_value_json: Any = None
    compute_json: dict[str, Any] | None = None
    detail_json: dict[str, Any] | None = None
    transform_json: dict[str, Any] | None = None


class BindingUpdateIn(InputModel):
    """改绑定。缺省的字段表示本次不涉及。

    ⚠ `field_key` 不在这里：改槽等于换一条绑定，而 id 是实时推送的关联键。
    要换槽就删了重建。
    """

    source_kind: SourceKind | None = None
    node_key: NodeKey | None = None
    static_value_json: Any = None
    compute_json: dict[str, Any] | None = None
    detail_json: dict[str, Any] | None = None
    transform_json: dict[str, Any] | None = None


class BindingListParams(InputModel):
    """绑定列表的过滤条件。"""

    node_id: uuid.UUID = Field(description="按画布节点过滤，必填")
