"""二进制模型的置换重要性使用上游封存结果，不重新拟合。"""

import json

from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.run_executor import execute_graph
from unit.modeling_fakes import (
    DirectRunner,
    edge,
    execution_of,
    linear_frame,
    node,
)


async def test_binary_model_feeds_permutation_importance_across_nodes() -> None:
    graph = PipelineGraph(
        nodes=[
            node(
                "source",
                "ledger_source",
                table_code="energy_h",
                columns=["温度", "负荷", "能耗"],
            ),
            node("split", "split_dataset", target_column="能耗"),
            node("model", "tree_regressor", n_estimators=8, random_state=42),
            node("importance", "feature_importance", repeats=2),
        ],
        edges=[
            edge("e1", "source", "frame", "split", "frame"),
            edge("e2", "split", "train", "model", "train"),
            edge("e3", "split", "test", "model", "test"),
            edge("e4", "model", "model", "importance", "model"),
            edge("e5", "split", "test", "importance", "test"),
        ],
    )
    result = await execute_graph(
        graph,
        execution=execution_of(
            DirectRunner(), frames={"source": linear_frame(120)}
        ),
    )
    assert result.status == "succeeded", result.error_text
    assert result.nodes[-1].report is not None
    assert "特征重要性" in json.dumps(
        result.nodes[-1].report, ensure_ascii=False
    )
    assert result.nodes[-1].artifact is None
