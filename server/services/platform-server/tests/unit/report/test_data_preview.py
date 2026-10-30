"""报告数据节点的配置校验与真实展示口径。"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import ColumnSpec, EffectiveRow
from platform_server.apps.report.schemas.document import DocumentNode
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.document import validate_template
from platform_server.apps.report.services.metrics import PreviewContext
from platform_server.apps.report.services.preview import preview
from platform_server.apps.report.services.source import SourceData


def chart_template(**attrs):
    return TemplateBody(
        name="趋势报告",
        doc_json=DocumentNode(
            type="doc",
            content=[
                DocumentNode(
                    type="dsChart",
                    attrs={
                        "series": [{"table": "energy", "key": "value"}],
                        **attrs,
                    },
                )
            ],
        ),
    )


def sample_rows():
    start = datetime(2026, 9, 1, tzinfo=UTC)
    return SourceData(
        rows=tuple(
            EffectiveRow(
                ts=start + timedelta(hours=hour),
                source="test",
                values={"value": str(hour + 1)},
            )
            for hour in (0, 1, 24)
        ),
        columns=(ColumnSpec("value", "用量", "number", "kWh"),),
        is_truncated=False,
    )


@pytest.mark.parametrize("node_type", ["dsChart", "dsTable"])
def test_data_node_limits_are_checked_before_saving(node_type):
    body = chart_template(limit=2000)
    body.doc_json.content[0].type = node_type
    result = validate_template(body)
    assert not result.is_valid
    assert result.issues[0].where.startswith("content.0")
    assert "2000" not in result.issues[0].message
    assert "https://" not in result.issues[0].message


@pytest.mark.parametrize("node_type", ["dsChart", "dsTable"])
def test_missing_data_node_source_blocks_template_validation(node_type):
    body = chart_template()
    body.doc_json.content[0] = DocumentNode(type=node_type)
    assert not validate_template(body).is_valid


async def test_chart_limit_keeps_latest_points_and_reports_truncation(
    monkeypatch,
):
    monkeypatch.setattr(
        PreviewContext, "read", AsyncMock(return_value=sample_rows())
    )
    async with AsyncSession() as session:
        result = await preview(
            session,
            PreviewContext(chart_template(limit=1), "2026-09", "UTC"),
        )
    chart = result.nodes["content.0"]
    assert [point.value for point in chart.series[0].points] == ["25"]
    assert chart.is_truncated


async def test_chart_buckets_aggregate_before_sorting(monkeypatch):
    monkeypatch.setattr(
        PreviewContext, "read", AsyncMock(return_value=sample_rows())
    )
    body = chart_template(bucket="day", agg="sum", order="desc")
    async with AsyncSession() as session:
        result = await preview(session, PreviewContext(body, "2026-09", "UTC"))
    points = result.nodes["content.0"].series[0].points
    assert [point.value for point in points] == ["25", "3"]
    assert points[0].ts > points[1].ts
