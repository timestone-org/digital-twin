"""层级图文档契约与有界图校验，兼容 Layerflow v1。"""

from collections import deque
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_NODES: int = 300
MAX_EDGES: int = 2000
Identifier = Annotated[str, Field(min_length=1, max_length=100)]
Coordinate = Annotated[float, Field(ge=-100000, le=100000, allow_inf_nan=False)]


class HierarchyShape(BaseModel):
    """有界输入，不保留未登记的配置字段。"""

    model_config = ConfigDict(
        extra="ignore",
        strict=True,
        str_strip_whitespace=True,
        populate_by_name=True,
    )


class HierarchyPosition(HierarchyShape):
    coordinate_x: Coordinate = Field(alias="x")
    coordinate_y: Coordinate = Field(alias="y")


class HierarchyViewport(HierarchyPosition):
    zoom: float = Field(ge=0.05, le=4, allow_inf_nan=False)


class HierarchyPaper(HierarchyShape):
    width: int = Field(ge=360, le=12000)


class HierarchyNode(HierarchyShape):
    id: Identifier
    kind: Literal["meter", "junction"]
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=100)
    parameter: str = Field(max_length=40)
    order: float = Field(ge=0, le=99999, allow_inf_nan=False)
    position: HierarchyPosition


class HierarchyEdge(HierarchyShape):
    id: Identifier
    source: Identifier
    target: Identifier


class HierarchyDocument(HierarchyShape):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    template_id: Literal["case-v1"] = Field(alias="templateId")
    title: str = Field(min_length=1, max_length=80)
    paper: HierarchyPaper
    nodes: list[HierarchyNode] = Field(max_length=MAX_NODES)
    edges: list[HierarchyEdge] = Field(max_length=MAX_EDGES)
    viewport: HierarchyViewport

    @model_validator(mode="after")
    def validate_graph(self) -> Self:
        """验证唯一性、引用与有向无环关系。"""
        by_id = {node.id: node for node in self.nodes}
        if len(by_id) != len(self.nodes):
            raise ValueError("节点标识重复")
        if len({node.code for node in self.nodes}) != len(self.nodes):
            raise ValueError("节点编号重复")
        validate_edges(self.edges, by_id)
        validate_acyclic(self.nodes, self.edges)
        return self


def validate_edges(
    edges: list[HierarchyEdge], nodes: dict[str, HierarchyNode]
) -> None:
    """验证连接端点与唯一性。Args: edges, nodes。"""
    pairs: set[tuple[str, str]] = set()
    identifiers: set[str] = set()
    for edge in edges:
        if edge.source not in nodes or edge.target not in nodes:
            raise ValueError("连接引用了不存在的节点")
        if edge.source == edge.target:
            raise ValueError("节点不能连接到自身")
        pair = (edge.source, edge.target)
        if pair in pairs or edge.id in identifiers:
            raise ValueError("存在重复连接或连接标识")
        if nodes[edge.source].kind == nodes[edge.target].kind == "junction":
            raise ValueError("汇流点之间不直接连接")
        pairs.add(pair)
        identifiers.add(edge.id)


def validate_acyclic(
    nodes: list[HierarchyNode], edges: list[HierarchyEdge]
) -> None:
    """以拓扑遍历拒绝循环。Args: nodes, edges。"""
    degrees = {node.id: 0 for node in nodes}
    children: dict[str, list[str]] = {node.id: [] for node in nodes}
    for edge in edges:
        degrees[edge.target] += 1
        children[edge.source].append(edge.target)
    pending = deque(key for key, degree in degrees.items() if degree == 0)
    count = 0
    while pending:
        parent = pending.popleft()
        count += 1
        for child in children[parent]:
            degrees[child] -= 1
            if degrees[child] == 0:
                pending.append(child)
    if count != len(nodes):
        raise ValueError("连接形成循环，层级图只允许从上游到下游的关系")
