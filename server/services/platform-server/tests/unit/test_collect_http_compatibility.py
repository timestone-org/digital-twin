"""读取扩展先落地，创建输入与数据库值域留在原协议集合。"""

import pytest
from pydantic import ValidationError
from sqlalchemy import CheckConstraint

from platform_server.apps.collect.models import CollectSource
from platform_server.apps.collect.schemas.point_search import PointMatchOut
from platform_server.apps.collect.schemas.source import (
    SourceCreateIn,
    SourceOut,
)


def test_http_outputs_are_readable_but_creation_is_rejected() -> None:
    for schema, field in (
        (SourceOut, "protocol"),
        (PointMatchOut, "source_protocol"),
    ):
        assert schema.model_json_schema()["properties"][field]["enum"] == [
            "http",
            "modbus_tcp",
            "opcua",
        ]
    with pytest.raises(ValidationError):
        SourceCreateIn.model_validate(
            {
                "name": "HTTP",
                "code": "http-1",
                "protocol": "http",
                "endpoint": "http://x",
            }
        )


def test_the_model_check_constraint_keeps_its_original_range() -> None:
    constraints = [
        str(constraint.sqltext)
        for constraint in CollectSource.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    ]
    assert "protocol IN ('modbus_tcp', 'opcua')" in constraints
