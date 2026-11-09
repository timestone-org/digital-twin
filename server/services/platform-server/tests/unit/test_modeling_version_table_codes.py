"""版本指纹里的台账与流水线来源台账同一份口径。"""

from types import SimpleNamespace

from platform_server.apps.modeling.services import model_service
from platform_server.apps.modeling.services.graph_walk import (
    source_table_codes,
)
from unit.modeling_fakes import linear_graph


def test_fingerprint_tables_match_the_pipeline_sources() -> None:
    graph = linear_graph()
    run = SimpleNamespace(graph_snapshot=graph.model_dump(mode="json"))
    assert model_service._table_codes_of(run) == list(source_table_codes(graph))
    assert model_service._table_codes_of(run)
