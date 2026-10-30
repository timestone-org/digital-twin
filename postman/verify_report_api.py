"""以真实本地 HTTP 验证报告取数、共享快照、试算与 Word 生成。"""

import argparse
import asyncio
import io
import json
import sys
import zipfile
from pathlib import Path

import httpx
from docx import Document
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError
from platform_server.apps.report.errors import (
    ReportApiReadFailed,
    ReportInvalid,
)
from platform_server.apps.report.schemas.api_source import (
    ReportApiColumn,
    ReportApiConnection,
    ReportApiSource,
)
from platform_server.apps.report.schemas.document import DocumentNode, MetricDef
from platform_server.apps.report.schemas.preview import PreviewOut
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.api_source import fetch_api_sources
from platform_server.apps.report.services.docx_builder import build_docx
from platform_server.apps.report.services.metrics import PreviewContext
from platform_server.apps.report.services.preview import preview

FIXTURE_ROWS = 3


def check(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def source(case: str = "good") -> ReportApiSource:
    return ReportApiSource(
        code="usage",
        name="合成能耗",
        connection="fixture",
        path="/query",
        method="POST",
        query={"case": case},
        body={
            "period": "{{period}}",
            "start": "{{start}}",
            "end": "{{end}}",
            "zone": "{{timezone}}",
        },
        rows_pointer="/data",
        time_pointer="/ts",
        columns=[
            ReportApiColumn(key="value", name="能耗", pointer="/value"),
            ReportApiColumn(
                key="label", name="名称", pointer="/label", data_type="text"
            ),
        ],
    )


def template(wanted: ReportApiSource) -> TemplateBody:
    metric = DocumentNode(
        type="metricRef", attrs={"expr": "{合计}", "precision": 3}
    )
    paragraph = DocumentNode(type="paragraph", content=[metric])
    chart = DocumentNode(
        type="dsChart",
        attrs={
            "title": "能耗趋势",
            "series": [{"table": "api:usage", "key": "value", "name": "能耗"}],
        },
    )
    table = DocumentNode(
        type="dsTable",
        attrs={
            "title": "能耗明细",
            "table": "api:usage",
            "keys": ["label", "value"],
            "decimals": 3,
        },
    )
    return TemplateBody(
        name="通用 API 报告仿真",
        api_sources=[wanted],
        metrics=[
            MetricDef(name="合计", table="api:usage", key="value", agg="sum"),
            MetricDef(name="最低值", table="api:usage", key="value", agg="min"),
        ],
        doc_json=DocumentNode(type="doc", content=[paragraph, chart, table]),
    )


async def stats(base_url: str) -> dict[str, int]:
    async with httpx.AsyncClient(trust_env=False, timeout=3) as client:
        response = await client.get(base_url + "/stats")
        response.raise_for_status()
        return response.json()["counts"]


async def verify(base_url: str) -> tuple[TemplateBody, PreviewOut]:
    connection = ReportApiConnection(
        code="fixture",
        name="本地合成接口",
        base_url=base_url,
        headers={"X-API-Key": SecretStr("local-report-fixture-only")},
    )
    before = await stats(base_url)
    wanted = source()
    data = await fetch_api_sources(
        [wanted], [connection], "2026-10", "month", "Asia/Shanghai"
    )
    configured = template(wanted)
    async with AsyncSession() as session:
        result = await preview(
            session,
            PreviewContext(
                template=configured,
                period="2026-10",
                timezone="Asia/Shanghai",
                api_data=data,
            ),
        )
    check(result.is_valid, f"Preview failed: {result.warnings}")
    check(
        [item.value for item in result.metrics]
        == ["9007199254740993.125", "0"],
        "Precision or zero changed",
    )
    check(
        data["api:usage"].rows[-1].values["value"] is None,
        "Missing data was filled",
    )
    check(
        len(result.nodes["content.1"].series[0].points) == FIXTURE_ROWS,
        "Chart lost rows",
    )
    check(
        len(result.nodes["content.2"].rows) == FIXTURE_ROWS, "Table lost rows"
    )
    after = await stats(base_url)
    check(
        after.get("good", 0) - before.get("good", 0) == 1,
        "Metrics/chart/table made duplicate HTTP calls",
    )
    for case, message in [
        ("503", "503"),
        ("missing", "缺少"),
        ("outside", "超出"),
        ("large", "2 MB"),
    ]:
        try:
            await fetch_api_sources(
                [source(case)],
                [connection],
                "2026-10",
                "month",
                "Asia/Shanghai",
            )
        except AppError as error:
            expected = ReportApiReadFailed if case == "503" else ReportInvalid
            check(isinstance(error, expected), f"Wrong error class for {case}")
            check(
                error.http_status == (503 if case == "503" else 400),
                f"Wrong HTTP status for {case}",
            )
            check(message in error.message, f"Unexpected failure for {case}")
            check("Synthetic" not in error.message, "Upstream body leaked")
        else:
            raise RuntimeError(f"{case} should fail explicitly")
    return configured, result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    configured, result = asyncio.run(verify(args.base_url))
    document = build_docx(configured, result)
    rendered = Document(io.BytesIO(document.payload))
    check(
        rendered.paragraphs[0].text == "9007199254740993.125",
        "Word inline precision changed",
    )
    with zipfile.ZipFile(io.BytesIO(document.payload)) as archive:
        xml = archive.read("word/document.xml").decode()
        check("真实零值" in xml and "缺测" in xml, "Word table rows lost")
        check(
            any(name.startswith("word/charts/") for name in archive.namelist()),
            "Native chart missing",
        )
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(document.payload)
    sys.stdout.write(
        json.dumps({"result": "passed", "docx_bytes": len(document.payload)})
        + "\n"
    )


if __name__ == "__main__":
    main()
