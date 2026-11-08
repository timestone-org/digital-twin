"""图表三种横轴的折算口径，以及 Word 原生图表对这份产物的逐字使用。"""

import io
import zipfile
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from docx import Document
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import ColumnSpec, EffectiveRow
from platform_server.apps.report.schemas.api_source import (
    ReportApiColumn,
    ReportApiSource,
)
from platform_server.apps.report.schemas.document import DocumentNode
from platform_server.apps.report.schemas.preview import (
    ChartSeries,
    NodeValue,
    PreviewOut,
)
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.chart_ooxml import chart_xml
from platform_server.apps.report.services.chart_raster import render_chart
from platform_server.apps.report.services.document import validate_template
from platform_server.apps.report.services.docx_builder import build_docx
from platform_server.apps.report.services.metrics import PreviewContext
from platform_server.apps.report.services.preview import preview
from platform_server.apps.report.services.source import SourceData


def chart_body(api_sources=(), **attrs):
    return TemplateBody(
        name="图表",
        api_sources=list(api_sources),
        doc_json=DocumentNode(
            type="doc",
            content=[DocumentNode(type="dsChart", attrs=attrs)],
        ),
    )


def workshop_rows():
    stamp = datetime(2026, 9, 1, tzinfo=UTC)
    rows = [("一车间", "10", "1"), ("二车间", "20", "2"), ("一车间", "30", "3")]
    return SourceData(
        rows=tuple(
            EffectiveRow(
                ts=stamp + timedelta(minutes=index),
                source="api",
                values={"shop": shop, "power": power, "water": water},
            )
            for index, (shop, power, water) in enumerate(rows)
        ),
        columns=(
            ColumnSpec("shop", "车间", "text", None),
            ColumnSpec("power", "用电", "number", "kWh"),
            ColumnSpec("water", "用水", "number", "t"),
        ),
        is_truncated=False,
    )


def energy_source():
    return ReportApiSource(
        code="energy",
        name="能耗",
        connection="ems",
        path="/energy",
        columns=[
            ReportApiColumn(
                key="shop", name="车间", pointer="/s", data_type="text"
            ),
            ReportApiColumn(key="power", name="用电", pointer="/p"),
            ReportApiColumn(key="water", name="用水", pointer="/w"),
        ],
    )


async def run_chart(monkeypatch, body, data, timezone="UTC"):
    monkeypatch.setattr(PreviewContext, "read", AsyncMock(return_value=data))
    async with AsyncSession() as session:
        return await preview(session, PreviewContext(body, "2026-09", timezone))


SERIES = [
    {"table": "api:energy", "key": "power", "name": "用电"},
    {"table": "api:energy", "key": "water", "name": "用水"},
]


async def test_category_axis_groups_rows_in_first_seen_order(monkeypatch):
    body = chart_body(
        [energy_source()],
        kind="bar",
        x_axis="category",
        category_key="shop",
        agg="sum",
        series=SERIES,
    )
    result = await run_chart(monkeypatch, body, workshop_rows())
    node = result.nodes["content.0"]
    assert result.is_valid, result.warnings
    assert node.x_axis == "category"
    assert node.categories == ["一车间", "二车间"]
    assert [series.values for series in node.series] == [
        ["40", "20"],
        ["4", "2"],
    ]
    assert node.series[0].points == []


async def test_field_axis_turns_each_series_into_one_category(monkeypatch):
    body = chart_body(
        [energy_source()],
        kind="pie",
        title="能耗构成",
        x_axis="field",
        agg="last",
        series=SERIES,
    )
    result = await run_chart(monkeypatch, body, workshop_rows())
    node = result.nodes["content.0"]
    assert node.categories == ["用电", "用水"]
    assert [series.name for series in node.series] == ["能耗构成"]
    assert node.series[0].values == ["30", "3"]


async def test_category_limit_marks_truncation(monkeypatch):
    body = chart_body(
        [energy_source()],
        x_axis="category",
        category_key="shop",
        limit=1,
        series=SERIES[:1],
    )
    result = await run_chart(monkeypatch, body, workshop_rows())
    assert result.nodes["content.0"].categories == ["一车间"]
    assert result.nodes["content.0"].is_truncated


async def test_time_labels_follow_bucket_in_business_timezone(monkeypatch):
    start = datetime(2026, 8, 31, 16, tzinfo=UTC)
    data = SourceData(
        rows=tuple(
            EffectiveRow(
                ts=start + timedelta(days=day), source="t", values={"v": "1"}
            )
            for day in range(3)
        ),
        columns=(ColumnSpec("v", "值", "number", None),),
        is_truncated=False,
    )
    body = chart_body(bucket="day", series=[{"table": "energy", "key": "v"}])
    result = await run_chart(monkeypatch, body, data, "Asia/Shanghai")
    node = result.nodes["content.0"]
    assert node.categories == ["09-01", "09-02", "09-03"]
    assert len(node.series[0].points) == 3
    assert node.series[0].name == "值"


async def test_time_axis_aligns_series_on_union_of_moments(monkeypatch):
    stamp = datetime(2026, 9, 1, tzinfo=UTC)
    first = SourceData(
        rows=(EffectiveRow(ts=stamp, source="t", values={"v": "1"}),),
        columns=(ColumnSpec("v", "本期", "number", None),),
        is_truncated=False,
    )
    second = SourceData(
        rows=(
            EffectiveRow(
                ts=stamp + timedelta(hours=1), source="t", values={"v": "2"}
            ),
        ),
        columns=(ColumnSpec("v", "上期", "number", None),),
        is_truncated=False,
    )
    monkeypatch.setattr(
        PreviewContext, "read", AsyncMock(side_effect=[first, second])
    )
    body = chart_body(
        time_format="time",
        series=[
            {"table": "energy", "key": "v"},
            {"table": "energy", "key": "v", "offset": -1},
        ],
    )
    async with AsyncSession() as session:
        result = await preview(session, PreviewContext(body, "2026-09", "UTC"))
    node = result.nodes["content.0"]
    assert node.categories == ["00:00", "01:00"]
    assert [series.values for series in node.series] == [
        ["1", None],
        [None, "2"],
    ]


@pytest.mark.parametrize(
    ("attrs", "message"),
    [
        ({"kind": "pie"}, "饼图"),
        ({"x_axis": "category"}, "分类字段"),
        ({"x_axis": "category", "category_key": "missing"}, "映射列"),
    ],
)
def test_axis_combinations_are_validated_before_saving(attrs, message):
    body = chart_body([energy_source()], series=SERIES[:1], **attrs)
    result = validate_template(body)
    assert not result.is_valid
    assert message in result.issues[0].message


def test_category_axis_rejects_series_from_mixed_sources():
    body = chart_body(
        [energy_source()],
        x_axis="category",
        category_key="shop",
        series=[SERIES[0], {"table": "energy", "key": "v"}],
    )
    assert "同一个数据来源" in validate_template(body).issues[0].message


def pie_node():
    return NodeValue(
        kind="pie",
        title="构成",
        x_axis="field",
        categories=["用电", "用水", "用气"],
        series=[ChartSeries(name="构成", points=[], values=["3", None, "1"])],
    )


def test_native_pie_has_one_colored_slice_per_category_and_legend():
    xml = chart_xml(pie_node()).decode()
    assert xml.count("<c:dPt>") == 3
    assert '<c:showPercent val="1"/>' in xml
    assert "<c:legend>" in xml
    assert '<c:pt idx="1">' not in xml.split("<c:val>")[1]


def test_single_series_line_has_no_legend_and_uses_server_labels():
    node = NodeValue(
        kind="line",
        categories=["2026-01", "2026-02"],
        series=[ChartSeries(name="值", points=[], values=["1", "2"])],
    )
    xml = chart_xml(node).decode()
    assert "<c:legend>" not in xml
    assert "<c:v>2026-02</c:v>" in xml
    assert "<c:majorGridlines>" in xml


def test_chart_without_categories_is_rejected():
    with pytest.raises(ValueError, match="有效数据"):
        chart_xml(NodeValue(kind="bar"))
    with pytest.raises(ValueError, match="有效数据"):
        render_chart(NodeValue(kind="bar"))


def test_raster_pie_is_png():
    assert render_chart(pie_node()).startswith(b"\x89PNG\r\n\x1a\n")


def test_word_embeds_native_pie_with_caption():
    body = chart_body(kind="pie", x_axis="field")
    result = build_docx(
        body,
        PreviewOut(
            is_valid=True,
            period="2026-09",
            timezone="UTC",
            metrics=[],
            nodes={"content.0": pie_node()},
            warnings=[],
        ),
    )
    document = Document(io.BytesIO(result.payload))
    assert document.paragraphs[0].text == "构成"
    assert document.paragraphs[0].style.name == "Caption"
    with zipfile.ZipFile(io.BytesIO(result.payload)) as archive:
        assert b"<c:pieChart>" in archive.read("word/charts/chart1.xml")
    assert not result.warnings
