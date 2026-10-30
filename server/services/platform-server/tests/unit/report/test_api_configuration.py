"""API 模板配置往返与连接目录的凭据隔离。"""

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from unit.wiring_fakes import build_settings

from platform_server.apps.report.api.renders import runtime
from platform_server.apps.report.models import ReportTemplate
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.template_service import to_output
from platform_server.settings import Settings


def source_body() -> TemplateBody:
    return TemplateBody.model_validate(
        {
            "name": "API 能耗月报",
            "api_sources": [
                {
                    "code": "energy",
                    "name": "能耗接口",
                    "connection": "ems",
                    "path": "/energy",
                    "columns": [
                        {
                            "key": "energy",
                            "name": "能耗",
                            "pointer": "/value",
                            "data_type": "number",
                        }
                    ],
                }
            ],
        }
    )


def test_saved_template_preserves_api_sources_and_legacy_defaults() -> None:
    body = source_body()
    stamp = datetime(2026, 10, 30, tzinfo=UTC)
    row = ReportTemplate(
        id=uuid.uuid4(),
        code="api_monthly",
        name=body.name,
        description=None,
        granularity="month",
        is_enabled=True,
        row_version=1,
        created_at=stamp,
        updated_at=stamp,
        body_json=body.model_dump(mode="json"),
    )
    assert to_output(row).api_sources == body.api_sources
    assert TemplateBody(name="存量模板").api_sources == []


def test_connection_codes_are_unique_at_startup() -> None:
    connection = {"code": "ems", "name": "能管", "base_url": "https://ems.test"}
    fields = build_settings().model_dump()
    fields["report_api_connections"] = [connection, connection]
    with pytest.raises(ValidationError, match="报告 API 连接编码不能重复"):
        Settings(_env_file=None, **fields)


async def test_runtime_catalog_never_exposes_connection_secrets() -> None:
    fields = build_settings().model_dump()
    fields["report_api_connections"] = [
        {
            "code": "ems",
            "name": "能管",
            "base_url": "https://private.example.test",
            "headers": {"Authorization": "Bearer server-only-test-value"},
        }
    ]
    settings = Settings(_env_file=None, **fields)
    result = await runtime(SimpleNamespace(settings=settings), None)
    assert result.data is not None
    assert [item.model_dump() for item in result.data.api_connections] == [
        {"code": "ems", "name": "能管"}
    ]
    wire = result.model_dump_json()
    assert "server-only-test-value" not in wire
    assert "private.example.test" not in wire
