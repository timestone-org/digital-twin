"""报告 API 单测共用的连接、来源与注入式读取假件。"""

import httpx
from pydantic import SecretStr

from platform_server.apps.report.schemas.api_source import (
    ReportApiConnection,
    ReportApiSource,
)
from platform_server.apps.report.services.api_source import (
    ApiSourceReader,
)


def connection(**changes):
    return ReportApiConnection.model_validate(
        {
            "code": "energy",
            "name": "能管系统",
            "base_url": "https://10.0.0.8/api",
            "headers": {"X-API-Key": SecretStr("fixture-only-key")},
            **changes,
        }
    )


def source(**changes):
    return ReportApiSource.model_validate(
        {
            "code": "usage",
            "name": "能耗",
            "connection": "energy",
            "path": "/query",
            "rows_pointer": "/data",
            "columns": [
                {
                    "key": "value",
                    "name": "能耗",
                    "pointer": "/value",
                    "data_type": "number",
                },
            ],
            **changes,
        }
    )


async def read(payload, *, configured=None, wanted=None):
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
    reader = ApiSourceReader(configured or [connection()], transport=transport)
    return await reader.fetch(
        [wanted or source()], "2026-10", "month", "Asia/Shanghai"
    )
