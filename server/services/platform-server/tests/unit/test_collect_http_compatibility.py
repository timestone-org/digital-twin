"""完整版本保留先行 reader 类型，并开放已实现的 HTTP 创建输入。"""

from typing import get_args

from platform_server.apps.collect.protocols import Protocol, ReadableProtocol
from platform_server.apps.collect.schemas.point_search import PointMatchOut
from platform_server.apps.collect.schemas.source import (
    SourceCreateIn,
    SourceOut,
)


def test_http_reader_alias_and_writer_are_both_complete() -> None:
    assert get_args(ReadableProtocol) == get_args(Protocol)
    created = SourceCreateIn.model_validate(
        {
            "name": "HTTP",
            "code": "http-1",
            "protocol": "http",
            "endpoint": "http://data.test/data",
            "read_mode": "poll",
            "options_json": {"auth_type": "none"},
        }
    )
    assert created.protocol == "http"
    for schema, field in (
        (SourceOut, "protocol"),
        (PointMatchOut, "source_protocol"),
    ):
        assert "http" in schema.model_json_schema()["properties"][field]["enum"]
