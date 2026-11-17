"""最新锚点按业务报告期判断陈旧，并传播到指标、表格和图表。"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import ColumnSpec, EffectiveRow
from platform_server.apps.report.schemas.document import DocumentNode, MetricDef
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services import metrics
from platform_server.apps.report.services.metrics import (
    PreviewContext,
    metric_window,
)
from platform_server.apps.report.services.preview import preview
from platform_server.apps.report.services.source import SourceData


@pytest.mark.parametrize(
    "calendar",
    [
        ("2023-12", "month", 0, "2023-11-30T16:00:00+00:00"),
        ("2024-01", "month", -1, "2023-11-30T16:00:00+00:00"),
        ("2023Q4", "quarter", 0, "2023-09-30T16:00:00+00:00"),
        ("2023", "year", 0, "2022-12-31T16:00:00+00:00"),
        ("2023-12-01", "day", 0, "2023-11-30T16:00:00+00:00"),
    ],
)
@pytest.mark.parametrize("window", [None, "12mo"])
@pytest.mark.parametrize("older", [False, True])
async def test_latest_is_stale_only_before_shifted_business_period(
    monkeypatch, calendar, window, older
):
    period, granularity, offset, start = calendar
    stamp = datetime.fromisoformat(start)
    if older:
        stamp -= timedelta(microseconds=1)
    monkeypatch.setattr(metrics, "latest_stamp", AsyncMock(return_value=stamp))
    body = TemplateBody(name="月报", granularity=granularity)
    metric = MetricDef(
        name="指数",
        table="green",
        key="value",
        mode="window_agg",
        agg="last",
        anchor="latest",
        offset=offset,
        window=window,
    )
    async with AsyncSession() as session:
        result = await metric_window(
            session, PreviewContext(body, period, "Asia/Shanghai"), metric
        )
    assert result.is_stale is older
    assert result.until == stamp + timedelta(microseconds=1)


@pytest.mark.parametrize("period", ["2023-12", "2026-11"])
async def test_latest_warnings_agree_across_metrics_tables_and_charts(
    monkeypatch, period
):
    stamp = datetime(2023, 11, 30, 16, tzinfo=UTC)
    monkeypatch.setattr(metrics, "latest_stamp", AsyncMock(return_value=stamp))

    async def read_window(_session, wanted):
        return SourceData(
            rows=(
                EffectiveRow(
                    ts=stamp, source="manual", values={"value": "0.5"}
                ),
            ),
            columns=(ColumnSpec("value", "指数", "number", None),),
            is_truncated=False,
            is_stale=wanted.is_stale,
        )

    monkeypatch.setattr(metrics, "read_window", read_window)
    body = preview_template()
    async with AsyncSession() as session:
        result = await preview(
            session, PreviewContext(body, period, "Asia/Shanghai")
        )
    assert [item.value for item in result.metrics] == ["0.5", "1.0"]
    assert len(result.nodes["content.1"].rows) == 1
    assert result.nodes["content.2"].series[0].points[0].value == "0.5"
    assert all(item.error is None for item in result.metrics)
    assert len(result.warnings) == (0 if period == "2023-12" else 4)
    assert [item.is_stale for item in result.metrics] == [
        period == "2026-11",
        period == "2026-11",
    ]


def preview_template() -> TemplateBody:
    """指标、表格和图表共用最新锚点的模板。"""
    return TemplateBody(
        name="月报",
        metrics=[
            MetricDef(
                name="均值",
                table="green",
                key="value",
                mode="window_agg",
                agg="avg",
                anchor="latest",
                window="12mo",
            ),
            MetricDef(name="派生", mode="expr", expr="{均值}*2"),
        ],
        doc_json=DocumentNode(
            type="doc",
            content=[
                DocumentNode(type="metricRef", attrs={"expr": "{均值}"}),
                DocumentNode(
                    type="dsTable",
                    attrs={
                        "table": "green",
                        "keys": ["value"],
                        "anchor": "latest",
                        "window": "12mo",
                    },
                ),
                DocumentNode(
                    type="dsChart",
                    attrs={
                        "series": [{"table": "green", "key": "value"}],
                        "anchor": "latest",
                        "window": "12mo",
                    },
                ),
            ],
        ),
    )
