"""流水线图的线形：节点、边、整张图。它同时是落库形态与导出件形态。

⚠ **边必须带端口**：只记两端节点的话，上游有两个节点都产出同名端口时，用户在
画布上无从表达要连哪一路（docs/MODELING_DESIGN.md D4）。
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# 图的线形版本。改形状要升它，导入时按它分派
GRAPH_FORMAT_VERSION = "1.0"
# 一张图最多几个节点 / 几条边。⚠ 无界的数组入参就是一次 OOM
MAX_NODES = 200
MAX_EDGES = 400
MAX_NODE_ID = 64


class NodePosition(BaseModel):
    """节点在画布上的位置。只影响观感，不参与任何寻址。"""

    model_config = ConfigDict(extra="forbid")

    left: float = 0.0
    top: float = 0.0


class GraphNode(BaseModel):
    """图上的一个算子实例。

    ⚠ `alias` **只做展示**：上下文寻址、边的两端、节点级执行记录一律用 `id`。
    参考实现拿 alias 当上下文主键却不给唯一约束，两个同名节点会静默互相覆盖
    输出（设计文档 D5）。
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=MAX_NODE_ID)
    operator: str = Field(min_length=1, max_length=MAX_NODE_ID)
    alias: str = Field(default="", max_length=128)
    config: dict[str, Any] = Field(default_factory=dict[str, Any])
    position: NodePosition = NodePosition()


class GraphEdge(BaseModel):
    """一条数据流。两端都必须指明端口名。"""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=MAX_NODE_ID)
    from_node: str = Field(min_length=1, max_length=MAX_NODE_ID)
    from_port: str = Field(min_length=1, max_length=MAX_NODE_ID)
    to_node: str = Field(min_length=1, max_length=MAX_NODE_ID)
    to_port: str = Field(min_length=1, max_length=MAX_NODE_ID)


class PipelineGraph(BaseModel):
    """一张完整的流水线图。整体保存、整体校验、整体运行。"""

    model_config = ConfigDict(extra="forbid")

    format_version: str = GRAPH_FORMAT_VERSION
    nodes: list[GraphNode] = Field(
        default_factory=list[GraphNode], max_length=MAX_NODES
    )
    edges: list[GraphEdge] = Field(
        default_factory=list[GraphEdge], max_length=MAX_EDGES
    )

    def node_by_id(self) -> dict[str, GraphNode]:
        """按 id 索引节点。重复 id 由图校验拦，这里只取最后一个。"""
        return {node.id: node for node in self.nodes}
