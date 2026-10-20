"""导入空白字段与明确取值的边界校验。"""

import uuid

import pytest
from pydantic import ValidationError

from platform_server.apps.collect.schemas.point_import import (
    PointImportIn,
    PointImportItemIn,
)


@pytest.mark.parametrize("empty", [None, "", " \t\n"])
def test_blank_fields_are_omitted_before_type_validation(empty: object) -> None:
    item = PointImportItemIn.model_validate(
        {
            "code": "sensor",
            "name": empty,
            "address": empty,
            "sampling_interval_ms": empty,
            "archive_enabled": empty,
            "unit": empty,
            "archive_retention_days": empty,
        }
    )
    assert item.model_dump(exclude_unset=True) == {"code": "sensor"}


def test_false_and_zero_are_explicit_updates() -> None:
    item = PointImportItemIn(code="sensor", archive_enabled=False, deadband=0)
    assert item.model_dump(exclude_unset=True) == {
        "code": "sensor",
        "archive_enabled": False,
        "deadband": 0,
    }


@pytest.mark.parametrize(
    "body",
    [
        {"code": " "},
        {"code": "bad:code"},
        {"code": "sensor", "unknown": ""},
        {"code": "sensor", "deadband": -1},
        {"code": "sensor", "sampling_interval_ms": 0},
        {"code": "sensor", "archive_retention_days": 0},
        [],
    ],
)
def test_invalid_nonblank_import_values_remain_errors(body: object) -> None:
    with pytest.raises(ValidationError):
        PointImportItemIn.model_validate(body)


@pytest.mark.parametrize("count", [0, 201])
def test_import_batch_size_is_bounded(count: int) -> None:
    with pytest.raises(ValidationError):
        PointImportIn(
            source_id=uuid.uuid4(),
            items=[
                PointImportItemIn(code=f"p{index}") for index in range(count)
            ],
        )
