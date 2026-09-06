"""模板引用、循环依赖、资源上限和精确聚合。"""

from decimal import Decimal

from platform_server.apps.report.schemas.document import DocumentNode, MetricDef
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.aggregation import (
    aggregate,
    format_number,
    wire_value,
)
from platform_server.apps.report.services.document import (
    validate_template,
    walk_nodes,
)


def test_decimal_aggregation_preserves_value():
    assert aggregate(["0.1", "0.2"], "sum") == Decimal("0.3")
    assert wire_value(aggregate(["0.1", "0.2"], "sum")) == "0.3"


def test_empty_is_not_zero_except_count():
    assert aggregate([None], "avg") is None
    assert aggregate([None], "count") == 0
    assert format_number(None) == "—"


def test_unknown_metric_reference_rejected():
    template = TemplateBody(
        name="月报",
        metrics=[MetricDef(name="派生", mode="expr", expr="{不存在}+1")],
    )
    result = validate_template(template)
    assert not result.is_valid
    assert "未定义" in result.issues[0].message


def test_metric_cycle_rejected():
    template = TemplateBody(
        name="月报",
        metrics=[
            MetricDef(name="甲", mode="expr", expr="{乙}"),
            MetricDef(name="乙", mode="expr", expr="{甲}"),
        ],
    )
    result = validate_template(template)
    assert not result.is_valid
    assert "循环" in result.issues[0].message


def test_incomplete_chip_is_saveable_with_warning():
    template = TemplateBody(
        name="月报",
        doc_json=DocumentNode(
            type="doc", content=[DocumentNode(type="metricRef")]
        ),
    )
    result = validate_template(template)
    assert result.is_valid
    assert result.issues[0].is_blocking is False


def test_node_paths_include_table_cells():
    root = DocumentNode(
        type="doc",
        content=[
            DocumentNode(
                type="table",
                content=[
                    DocumentNode(
                        type="tableRow",
                        content=[
                            DocumentNode(
                                type="tableCell",
                                content=[DocumentNode(type="metricRef")],
                            )
                        ],
                    )
                ],
            )
        ],
    )
    found = list(walk_nodes(root))
    assert found[-1][0] == "content.0.content.0.content.0.content.0"
