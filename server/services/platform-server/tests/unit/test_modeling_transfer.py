"""流水线迁移的版本、算子清单、结构与配置分级校验。"""

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators import registry
from platform_server.apps.modeling.schemas.graph import GraphEdge, PipelineGraph
from platform_server.apps.modeling.schemas.transfer import (
    PipelineTransferDocument,
    TransferOperator,
    TransferPipeline,
)
from platform_server.apps.modeling.services.pipeline_transfer import (
    inspect_document,
)
from unit.modeling_fakes import linear_graph, node


def document(graph: PipelineGraph | None = None) -> PipelineTransferDocument:
    graph = graph or PipelineGraph(
        nodes=[node("s", "ledger_source", table_code="energy")]
    )
    return PipelineTransferDocument(
        format_version="1.0",
        pipeline=TransferPipeline(code="energy", name="能耗分析", graph=graph),
        operators=[
            TransferOperator(
                operator=code, spec_version=registry.get(code).SPEC_VERSION
            )
            for code in sorted({item.operator for item in graph.nodes})
        ],
    )


def test_valid_document_preserves_graph_and_reports_sources() -> None:
    source = document()
    checked = inspect_document(source)
    assert checked.can_import is True
    assert checked.issues == []
    assert checked.source_table_codes == ["energy"]
    assert checked.node_count == 1
    assert checked.edge_count == 0
    assert checked.document.model_dump() == source.model_dump()


@pytest.mark.parametrize("kind", ["missing", "duplicate", "extra", "unknown"])
def test_invalid_operator_manifests_block_import(kind: str) -> None:
    source = document()
    if kind == "missing":
        source.operators = []
    elif kind == "duplicate":
        source.operators.append(source.operators[0])
    elif kind == "extra":
        source.operators.append(
            TransferOperator(operator="standardize", spec_version="1.0")
        )
    else:
        source.pipeline.graph.nodes[0].operator = "unknown_operator"
        source.operators = [
            TransferOperator(operator="unknown_operator", spec_version="1.0")
        ]
    checked = inspect_document(source)
    assert checked.can_import is False
    assert any(issue.level == "error" for issue in checked.issues)


def test_version_difference_is_visible_and_does_not_prevent_import() -> None:
    source = document()
    source.operators[0].spec_version = "0.1"
    checked = inspect_document(source)
    assert checked.can_import is True
    assert checked.issues[0].level == "warning"
    assert "契约版本不同" in checked.issues[0].message


def test_incomplete_parameters_remain_a_visible_draft() -> None:
    source = document()
    source.pipeline.graph.nodes[0].config = {}
    checked = inspect_document(source)
    assert checked.can_import is True
    assert any(
        "数据台账" in issue.message and issue.level == "warning"
        for issue in checked.issues
    )


def test_unknown_configuration_parameters_block_import() -> None:
    source = document()
    source.pipeline.graph.nodes[0].config["api_key"] = "not-exportable"
    checked = inspect_document(source)
    assert checked.can_import is False
    assert any(
        issue.level == "error" and issue.node_id == "s"
        for issue in checked.issues
    )


def test_nested_object_cannot_be_used_as_a_scalar_parameter() -> None:
    source = document()
    source.pipeline.graph.nodes[0].config["table_code"] = {
        "url": "example",
        "api_key": "synthetic",
    }
    checked = inspect_document(source)
    assert checked.can_import is False
    assert any(issue.level == "error" for issue in checked.issues)


def test_empty_graph_is_a_portable_draft_but_dangling_edges_are_rejected() -> (
    None
):
    source = document()
    source.pipeline.graph = PipelineGraph()
    source.operators = []
    checked = inspect_document(source)
    assert checked.can_import is True
    assert any("空白草稿" in issue.message for issue in checked.issues)
    source.pipeline.graph.edges = [
        GraphEdge(
            id="dangling",
            from_node="x",
            from_port="frame",
            to_node="y",
            to_port="frame",
        )
    ]
    assert inspect_document(source).can_import is False


@pytest.mark.parametrize(
    "kind",
    ["dangling", "port", "cycle", "duplicate_edge", "unwired", "graph_version"],
)
def test_invalid_graph_structure_blocks_import(kind: str) -> None:
    source = document(linear_graph())
    graph = source.pipeline.graph
    if kind == "dangling":
        graph.edges[0].from_node = "absent"
    if kind == "port":
        graph.edges[0].from_port = "absent"
    if kind == "cycle":
        graph.edges.append(
            GraphEdge(
                id="cycle",
                from_node="f",
                from_port="frame",
                to_node="f",
                to_port="frame",
            )
        )
    if kind == "duplicate_edge":
        graph.edges[1].id = graph.edges[0].id
    if kind == "unwired":
        graph.edges = []
    if kind == "graph_version":
        graph.format_version = "2.0"
    checked = inspect_document(source)
    assert checked.can_import is False
    assert any(issue.level == "error" for issue in checked.issues)


def test_fit_row_changes_before_split_block_import() -> None:
    graph = linear_graph()
    graph.nodes.append(node("drop", "drop_missing"))
    incoming = next(edge for edge in graph.edges if edge.to_node == "p")
    previous = incoming.from_node
    incoming.from_node = "drop"
    graph.edges.append(
        GraphEdge(
            id="before_drop",
            from_node=previous,
            from_port="frame",
            to_node="drop",
            to_port="frame",
        )
    )
    checked = inspect_document(document(graph))
    assert checked.can_import is False
    assert any(
        "防泄漏" in issue.message and issue.level == "error"
        for issue in checked.issues
    )


@pytest.mark.parametrize("patch", [{"format_version": "2.0"}, {"runs": []}])
def test_unknown_document_version_and_metadata_are_rejected(
    patch: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        PipelineTransferDocument.model_validate(
            {**document().model_dump(), **patch}
        )


def test_large_json_configuration_is_rejected() -> None:
    source = document().model_dump()
    source["pipeline"]["graph"]["nodes"][0]["config"]["large"] = "x" * (
        2 * 1024 * 1024
    )
    with pytest.raises(ValidationError, match="2 MB"):
        PipelineTransferDocument.model_validate(source)
