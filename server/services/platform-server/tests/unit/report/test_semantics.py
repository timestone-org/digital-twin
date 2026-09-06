"""报告聚合、格式化、文档校验与日历边界。"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.report.schemas.document import DocumentNode, MetricDef
from platform_server.apps.report.schemas.jobs import ScheduleOut
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.aggregation import (
    aggregate,
    decimal_value,
    format_number,
    wire_value,
)
from platform_server.apps.report.services.document import (
    validate_template,
    walk_nodes,
)
from platform_server.apps.report.services.metrics import PreviewContext
from platform_server.apps.report.services.period import (
    WindowOptions,
    bounds,
    format_period,
    parse_period,
    resolve_window,
)
from platform_server.apps.report.services.preview import preview
from platform_server.apps.report.services.scheduler import (
    due_period,
    next_due_period,
)


@pytest.mark.parametrize(
    ("mode", "expected"),
    [
        ("avg", Decimal("2")),
        ("sum", Decimal("6")),
        ("min", Decimal("1")),
        ("max", Decimal("3")),
        ("first", "1"),
        ("last", "3"),
        ("count", 3),
        ("delta", Decimal("2")),
    ],
)
def test_aggregation_modes(mode, expected):
    assert aggregate([None, "1", "2", "3"], mode) == expected


@pytest.mark.parametrize(
    "value", [None, "bad", "NaN", "Infinity", float("inf")]
)
def test_invalid_numbers_do_not_enter_aggregation(value):
    assert decimal_value(value) is None


@pytest.mark.parametrize(
    ("value", "expected"),
    [(True, "1.00"), ("正常", "正常"), ("2.125", "2.12"), (None, "—")],
)
def test_document_number_format(value, expected):
    assert format_number(value) == expected


def test_wire_preserves_boolean_and_finite_decimal():
    assert wire_value(True) is True
    assert wire_value(Decimal("12.340")) == "12.340"
    assert wire_value(float("inf")) is None


@pytest.mark.parametrize(
    ("period", "granularity", "end"),
    [
        ("2026Q4", "quarter", "2027-01-01"),
        ("2026", "year", "2027-01-01"),
        ("2026-12-31", "day", "2027-01-01"),
    ],
)
def test_report_calendar_boundaries(period, granularity, end):
    start, finish = bounds(period, granularity, UTC)
    assert finish.date().isoformat() == end
    assert format_period(start, granularity) == period


def test_custom_window_is_relative_to_period_end():
    start, end = resolve_window(
        "2026-03", "month", UTC, WindowOptions(offset=-1, window="12mo")
    )
    assert start == datetime(2025, 3, 1, tzinfo=UTC)
    assert end == datetime(2026, 3, 1, tzinfo=UTC)


@pytest.mark.parametrize(
    ("period", "granularity"),
    [
        ("2026-02-30", "day"),
        ("2026Q5", "quarter"),
        ("0", "year"),
        ("2026-00", "month"),
    ],
)
def test_invalid_period_rejected(period, granularity):
    with pytest.raises(ValueError, match=r"."):
        parse_period(period, granularity)


def test_scheduler_waits_for_late_data():
    now = datetime(2026, 9, 1, 0, tzinfo=UTC)
    assert due_period(now, "month", 24, "Asia/Shanghai") == "2026-07"
    assert due_period(now, "month", 0, "Asia/Shanghai") == "2026-08"


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "x", "mode": "expr"},
        {"name": "x", "table": "t"},
        {"name": "", "mode": "expr", "expr": "1"},
        {"name": "x", "mode": "expr", "expr": "1", "offset": 121},
    ],
)
def test_metric_fields_are_validated(payload):
    with pytest.raises(ValidationError):
        MetricDef.model_validate(payload)


def test_deep_document_rejected_without_recursive_walk():
    node = DocumentNode(type="paragraph")
    for _ in range(32):
        node = DocumentNode(type="doc", content=[node])
    with pytest.raises(ValueError, match="层级"):
        list(walk_nodes(node))


@pytest.mark.parametrize(
    "expression", ["{未定义}", "PREV({x})", "1+", "x" * 2001]
)
def test_invalid_business_expression_rejected(expression):
    body = TemplateBody(
        name="月报",
        doc_json=DocumentNode(
            type="doc",
            content=[
                DocumentNode(type="metricRef", attrs={"expr": expression})
            ],
        ),
    )
    assert not validate_template(body).is_valid


async def test_derived_metrics_and_conditional_text_share_formula_semantics():
    body = TemplateBody(
        name="月报",
        metrics=[
            MetricDef(name="本期", mode="expr", expr="80"),
            MetricDef(name="上期", mode="expr", expr="100"),
            MetricDef(
                name="变化", mode="expr", expr="({本期}-{上期})/{上期}*100"
            ),
        ],
        doc_json=DocumentNode(
            type="doc",
            content=[
                DocumentNode(
                    type="paragraph",
                    content=[
                        DocumentNode(
                            type="metricRef",
                            attrs={"expr": "{变化}", "unit": "%"},
                        ),
                        DocumentNode(
                            type="condText",
                            attrs={"expr": "IF({本期}>{上期}, '升高', '降低')"},
                        ),
                    ],
                )
            ],
        ),
    )
    async with AsyncSession() as session:
        result = await preview(
            session,
            PreviewContext(template=body, period="2026-08", timezone="UTC"),
        )
    assert result.nodes["content.0.content.0"].text == "-20.00%"
    assert result.nodes["content.0.content.1"].text == "降低"
    assert result.is_valid


def test_schedule_catches_up_without_moving_watermark_backwards():
    rule = ScheduleOut(
        id=uuid.uuid4(),
        template_id=uuid.uuid4(),
        name="月报",
        granularity="month",
        delay_hours=0,
        is_enabled=True,
        row_version=1,
        last_run_period="2026-05",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    now = datetime(2026, 9, 6, tzinfo=UTC)
    assert next_due_period(rule, now, "UTC") == "2026-06"
    rule.last_run_period = "2026-08"
    assert next_due_period(rule, now, "UTC") is None
    rule.last_run_period = "2026-10"
    assert next_due_period(rule, now, "UTC") is None
