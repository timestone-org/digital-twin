"""API 映射结果在试算、指标与出稿之间共用同一快照。"""

import io
import uuid
import zipfile
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from docx.oxml import parse_xml
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import ColumnSpec, EffectiveRow
from platform_server.apps.report.errors import ReportInvalid
from platform_server.apps.report.schemas.api_source import ReportApiSource
from platform_server.apps.report.schemas.document import DocumentNode, MetricDef
from platform_server.apps.report.schemas.preview import PreviewIn
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services import metrics, template_preview
from platform_server.apps.report.services.document import validate_template
from platform_server.apps.report.services.docx_builder import build_docx
from platform_server.apps.report.services.metrics import PreviewContext
from platform_server.apps.report.services.preview import preview
from platform_server.apps.report.services.source import SourceData


def api_template(**changes):
    source = ReportApiSource(
        code="energy",
        name="能源接口",
        connection="ems",
        path="/monthly",
        offset=-1,
        columns=[
            {"key": "value", "name": "用量", "pointer": "/amount"},
        ],
    )
    return TemplateBody(name="API 报告", api_sources=[source], **changes)


def api_snapshot(count=3):
    start = datetime(2026, 8, 1, tzinfo=UTC)
    return {
        "api:energy": SourceData(
            rows=tuple(
                EffectiveRow(
                    ts=start + timedelta(days=index),
                    source="api:energy",
                    values={"value": Decimal("0.1")},
                )
                for index in range(count)
            ),
            columns=(ColumnSpec("value", "用量", "number", ""),),
            is_truncated=False,
        )
    }


async def test_metrics_tables_and_charts_reuse_api_snapshot(monkeypatch):
    ledger = AsyncMock(side_effect=AssertionError("不应读取台账"))
    monkeypatch.setattr(metrics, "read_window", ledger)
    body = api_template(
        metrics=[
            MetricDef(name="总量", table="api:energy", key="value", agg="sum")
        ],
        doc_json=DocumentNode(
            type="doc",
            content=[
                DocumentNode(
                    type="dsTable",
                    attrs={"table": "api:energy", "keys": ["value"]},
                ),
                DocumentNode(
                    type="dsChart",
                    attrs={"series": [{"table": "api:energy", "key": "value"}]},
                ),
            ],
        ),
    )
    context = PreviewContext(body, "2026-09", "UTC", api_data=api_snapshot())
    async with AsyncSession() as session:
        result = await preview(session, context)
    assert result.is_valid
    assert result.metrics[0].value == "0.3"
    assert result.metrics[0].since == datetime(2026, 8, 1, tzinfo=UTC)
    assert result.metrics[0].until == datetime(2026, 9, 1, tzinfo=UTC)
    assert len(result.nodes["content.0"].rows) == 3
    assert len(result.nodes["content.1"].series[0].points) == 3
    assert len(context.windows) == 1
    ledger.assert_not_called()


@pytest.mark.parametrize(
    "changes", [{"offset": 1}, {"window": "1mo"}, {"anchor": "latest"}]
)
def test_api_metric_rejects_a_second_time_window(changes):
    body = api_template(
        metrics=[
            MetricDef(name="值", table="api:energy", key="value", **changes)
        ]
    )
    result = validate_template(body)
    assert not result.is_valid
    assert result.issues[0].where == "metrics.0"
    assert "数据来源" in result.issues[0].message


@pytest.mark.parametrize(
    ("table", "key"), [("api:unknown", "value"), ("api:energy", "missing")]
)
def test_api_metric_rejects_undefined_source_or_field(table, key):
    body = api_template(metrics=[MetricDef(name="值", table=table, key=key)])
    assert not validate_template(body).is_valid


async def test_api_samples_are_available_before_inserting_content():
    context = PreviewContext(
        api_template(), "2026-09", "UTC", api_data=api_snapshot(7)
    )
    async with AsyncSession() as session:
        result = await preview(session, context)
    assert result.is_valid
    assert result.checked_at is not None
    sample = result.api_results[0]
    assert sample.source_code == "energy"
    assert sample.name == "能源接口"
    assert sample.row_count == 7
    assert sample.columns == ["用量"]
    assert sample.rows == [["0.1"]] * 5


async def test_api_source_is_not_silently_replaced_when_not_fetched():
    body = api_template(
        metrics=[MetricDef(name="值", table="api:energy", key="value")]
    )
    async with AsyncSession() as session:
        result = await preview(session, PreviewContext(body, "2026-09", "UTC"))
    assert not result.is_valid
    assert result.metrics[0].value is None
    assert "尚未获取" in result.metrics[0].error


async def test_trial_fetches_api_after_ending_database_transaction(monkeypatch):
    body = api_template()
    monkeypatch.setattr(
        template_preview,
        "require_template",
        AsyncMock(return_value=SimpleNamespace(body_json=body.model_dump())),
    )
    async with AsyncSession() as session:
        await session.begin()
        assert session.in_transaction()

        async def fetch(*_arguments):
            assert not session.in_transaction()
            return api_snapshot()

        reader = AsyncMock(side_effect=fetch)
        monkeypatch.setattr(template_preview, "fetch_api_sources", reader)
        result = await template_preview.preview_template(
            session, uuid.uuid4(), PreviewIn(period="2026-09"), "UTC"
        )
    assert result.api_results[0].row_count == 3
    reader.assert_awaited_once()


async def test_trial_propagates_safe_api_failure(monkeypatch):
    body = api_template()
    monkeypatch.setattr(
        template_preview,
        "require_template",
        AsyncMock(return_value=SimpleNamespace(body_json=body.model_dump())),
    )
    monkeypatch.setattr(
        template_preview,
        "fetch_api_sources",
        AsyncMock(side_effect=ReportInvalid("API 字段映射缺失")),
    )
    async with AsyncSession() as session:
        with pytest.raises(ReportInvalid, match="字段映射缺失"):
            await template_preview.preview_template(
                session, uuid.uuid4(), PreviewIn(period="2026-09"), "UTC"
            )


def precise_inline_context(value):
    body = api_template(
        metrics=[
            MetricDef(
                name="总量", table="api:energy", key="value", mode="latest"
            )
        ],
        doc_json=DocumentNode(
            type="doc",
            content=[
                DocumentNode(
                    type="paragraph",
                    content=[
                        DocumentNode(type="text", text="合计："),
                        DocumentNode(
                            type="metricRef",
                            attrs={
                                "expr": "{总量}",
                                "precision": 3,
                                "unit": " kWh",
                            },
                        ),
                    ],
                )
            ],
        ),
    )
    data = api_snapshot(1)
    data["api:energy"].rows[0].values["value"] = Decimal(value)
    return PreviewContext(body, "2026-09", "UTC", api_data=data)


@pytest.mark.parametrize(
    "value", ["9007199254740993.125", "-9007199254740993.125", "0.125"]
)
async def test_direct_metric_reference_preserves_decimal_precision(value):
    context = precise_inline_context(value)
    async with AsyncSession() as session:
        result = await preview(session, context)
    assert result.metrics[0].value == value
    assert result.nodes["content.0.content.1"].text == f"{value} kWh"


async def test_word_inline_paragraph_uses_exact_metric_value():
    context = precise_inline_context("9007199254740993.125")
    async with AsyncSession() as session:
        result = await preview(session, context)
    generated = build_docx(context.template, result)
    with zipfile.ZipFile(io.BytesIO(generated.payload)) as archive:
        xml = parse_xml(archive.read("word/document.xml"))
    namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    paragraph = xml.find(f"{{{namespace}}}body/{{{namespace}}}p")
    assert paragraph is not None
    text = "".join(
        item.text or "" for item in paragraph.iter(f"{{{namespace}}}t")
    )
    assert text == "合计：9007199254740993.125 kWh"


def typed_inline_context(kind, value):
    body = api_template(
        metrics=[
            MetricDef(
                name="字段", table="api:energy", key="value", mode="latest"
            )
        ],
        doc_json=DocumentNode(
            type="doc",
            content=[
                DocumentNode(
                    type="paragraph",
                    content=[
                        DocumentNode(type="text", text="字段："),
                        DocumentNode(
                            type="metricRef",
                            attrs={
                                "expr": "{字段}",
                                "precision": 2,
                                "unit": " kWh",
                            },
                        ),
                    ],
                ),
                DocumentNode(
                    type="dsTable",
                    attrs={"table": "api:energy", "keys": ["value"]},
                ),
            ],
        ),
    )
    body.api_sources[0].columns[0].data_type = kind
    found = SourceData(
        rows=(
            EffectiveRow(
                ts=datetime(2026, 8, 1, tzinfo=UTC),
                source="api:energy",
                values={"value": value},
            ),
        ),
        columns=(ColumnSpec("value", "字段", kind, ""),),
        is_truncated=False,
    )
    return PreviewContext(
        body, "2026-09", "UTC", api_data={"api:energy": found}
    )


@pytest.mark.parametrize(
    ("kind", "value", "expected"),
    [
        ("text", "00123", "00123"),
        ("boolean", True, "true"),
        ("boolean", False, "false"),
    ],
)
async def test_direct_text_and_boolean_keep_their_type(kind, value, expected):
    context = typed_inline_context(kind, value)
    async with AsyncSession() as session:
        result = await preview(session, context)
    assert result.nodes["content.0.content.1"].text == expected
    assert result.nodes["content.1"].rows[0][1] == expected


@pytest.mark.parametrize(
    ("kind", "value", "expected"),
    [("text", "00123", "字段：00123"), ("boolean", True, "字段：true")],
)
async def test_word_paragraph_preserves_text_codes_and_boolean(
    kind, value, expected
):
    context = typed_inline_context(kind, value)
    async with AsyncSession() as session:
        result = await preview(session, context)
    generated = build_docx(context.template, result)
    with zipfile.ZipFile(io.BytesIO(generated.payload)) as archive:
        xml = parse_xml(archive.read("word/document.xml"))
    namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    paragraph = xml.find(f"{{{namespace}}}body/{{{namespace}}}p")
    assert paragraph is not None
    text = "".join(
        item.text or "" for item in paragraph.iter(f"{{{namespace}}}t")
    )
    assert text == expected


@pytest.mark.parametrize("kind", ["text", "boolean"])
def test_chart_rejects_non_numeric_api_fields(kind):
    context = typed_inline_context(kind, "00123" if kind == "text" else True)
    context.template.doc_json = DocumentNode(
        type="doc",
        content=[
            DocumentNode(
                type="dsChart",
                attrs={"series": [{"table": "api:energy", "key": "value"}]},
            )
        ],
    )
    checked = validate_template(context.template)
    assert not checked.is_valid
    assert "数字类型" in checked.issues[0].message


@pytest.mark.parametrize(
    ("expression", "expected"),
    [("IF(1 == 1, '00123', '0')", "00123"), ("1 < 2", "true")],
)
async def test_formula_result_type_controls_inline_presentation(
    expression, expected
):
    body = TemplateBody(
        name="公式",
        doc_json=DocumentNode(
            type="doc",
            content=[
                DocumentNode(
                    type="paragraph",
                    content=[
                        DocumentNode(
                            type="metricRef",
                            attrs={"expr": expression, "unit": " kWh"},
                        )
                    ],
                ),
            ],
        ),
    )
    async with AsyncSession() as session:
        result = await preview(session, PreviewContext(body, "2026-09", "UTC"))
    assert result.nodes["content.0.content.0"].text == expected
