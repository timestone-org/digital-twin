"""建模用例的公共件：造帧、造图。

⚠ 数据造成**严格线性**关系 `能耗 = 2×温度 + 3×负荷 + 5`：能拿它逐个系数手算
核对，「跑完没报错」不等于「算对了」（docs/MODELING_DESIGN.md §10.3）。
"""

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    Provenance,
)
from platform_server.apps.modeling.schemas.graph import (
    GraphEdge,
    GraphNode,
    PipelineGraph,
)

# 真实关系的三个参数
SLOPE_TEMP = 2.0
SLOPE_LOAD = 3.0
INTERCEPT = 5.0
# 一小时一行，起点随便取一个 UTC 毫秒时刻
STEP_MS = 3_600_000
START_MS = 1_754_380_800_000

COLUMNS = (
    FrameColumn(key="温度", name="环境温度", dtype="number", unit="℃"),
    FrameColumn(key="负荷", name="瞬时负荷", dtype="number"),
    FrameColumn(key="能耗", name="能耗", dtype="number"),
)


def linear_frame(rows: int = 200) -> Frame:
    """一份严格线性的帧。

    Args: rows。
    """
    matrix: list[tuple[CellValue, ...]] = []
    for index in range(rows):
        temperature = 20.0 + (index % 13) * 0.7
        load = 400.0 + (index % 7) * 15.0
        matrix.append(
            (
                temperature,
                load,
                SLOPE_TEMP * temperature + SLOPE_LOAD * load + INTERCEPT,
            )
        )
    return Frame(
        columns=COLUMNS,
        rows=tuple(matrix),
        index=tuple(START_MS + index * STEP_MS for index in range(rows)),
        provenance=Provenance(table_codes=("energy_h",)),
    )


def with_hole(frame: Frame, *, row: int, key: str) -> Frame:
    """在某一行某一列上挖一个空值。

    Args: frame, row, key。
    """
    position = frame.position_of(key)
    holed = list(frame.rows)
    cells = list(holed[row])
    cells[position] = None
    holed[row] = tuple(cells)
    return Frame(
        columns=frame.columns,
        rows=tuple(holed),
        index=frame.index,
        index_name=frame.index_name,
        provenance=frame.provenance,
    )


def node(node_id: str, operator: str, **config: object) -> GraphNode:
    """造一个节点。

    Args: node_id, operator, config。
    """
    return GraphNode(id=node_id, operator=operator, config=dict(config))


def linear_graph() -> PipelineGraph:
    """五类算子各一个的最小闭环。

    取数 → 填缺失 → 标准化 → 切分 → 线性回归 → 回归评估。
    """
    return PipelineGraph(
        nodes=[
            node(
                "s",
                "ledger_source",
                table_code="energy_h",
                columns=["温度", "负荷", "能耗"],
            ),
            node("f", "fill_missing"),
            node("z", "standardize"),
            node("p", "split_dataset", target_column="能耗"),
            node("m", "linear_regression"),
            node("e", "regression_metrics"),
        ],
        edges=[
            _edge("e1", "s", "frame", "f", "frame"),
            _edge("e2", "f", "frame", "z", "frame"),
            _edge("e3", "z", "frame", "p", "frame"),
            _edge("e4", "p", "train", "m", "train"),
            _edge("e5", "p", "test", "m", "test"),
            _edge("e6", "m", "scored", "e", "scored"),
        ],
    )


def _edge(
    edge_id: str, source: str, out_port: str, target: str, in_port: str
) -> GraphEdge:
    return GraphEdge(
        id=edge_id,
        from_node=source,
        from_port=out_port,
        to_node=target,
        to_port=in_port,
    )
