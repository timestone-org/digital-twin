"""流水线面的入参与出参。ORM 模型绝不直接返给 HTTP 层。"""

import uuid

from pydantic import Field

from platform_server.apps.modeling.schemas.common import (
    InputModel,
    Label,
    Note,
    OutputModel,
    PipelineCode,
    Utc,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph


class PipelineCreateIn(InputModel):
    """建一条流水线。图可以先留空，之后再存。"""

    code: PipelineCode
    name: Label
    description: Note | None = None
    graph: PipelineGraph = PipelineGraph()


class PipelineUpdateIn(InputModel):
    """整体保存一条流水线。

    ⚠ `code` 不在里面：它是导出 / 导入的对齐键，建后不可改。
    """

    name: Label | None = None
    description: Note | None = None
    graph: PipelineGraph | None = None


class PipelineSummaryOut(OutputModel):
    """列表页要的那几样，不带图。"""

    id: uuid.UUID
    code: str
    name: str
    description: str | None
    node_count: int
    source_table_codes: list[str]
    created_by_name: str | None
    created_at: Utc
    updated_at: Utc


class PipelineOut(PipelineSummaryOut):
    """详情，带整张图。"""

    graph: PipelineGraph


class GraphCheckIn(InputModel):
    """校验**哪一张**图。

    ⚠ 给了 `graph` 就校验这一张（画布上那份还没保存的），不给才回退到库里那份：
    画布上边改边校验是这个端点存在的全部理由，只认库里那份的话，用户看到的
    永远是上一次保存时的问题（docs/MODELING_DESIGN.md §8.2）。
    """

    graph: PipelineGraph | None = None


class GraphIssueOut(OutputModel):
    """一条图校验问题。`node_id` / `edge_id` 给界面定位。"""

    message: str
    node_id: str = ""
    edge_id: str = ""


class GraphCheckOut(OutputModel):
    """一次图校验的结果。

    ⚠ 问题**逐条列出**而不是只报第一条：改完一条再跑一次才发现第二条，是最
    劝退的交互。
    """

    is_valid: bool
    issues: list[GraphIssueOut] = Field(default_factory=list[GraphIssueOut])
    #: `{节点 id: 这个节点输入上看得见的列}`；`null` = 静态推不出来，不收窄。
    #: ⚠ 前端的列选择器读它，不许自己再算一份
    known_columns: dict[str, list[str] | None] = Field(
        default_factory=dict[str, list[str] | None]
    )
