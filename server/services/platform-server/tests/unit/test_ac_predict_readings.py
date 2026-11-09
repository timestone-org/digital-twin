"""试算读数的入参边界：非有限值一律拒绝，越界值照收、由推理侧按缺测处理。"""

import math

import pytest
from pydantic import ValidationError

from platform_server.apps.hvac.schemas import PredictReadingsIn

FIELDS = [
    "workshop_temp_avg",
    "workshop_humidity_avg",
    "fresh_air_temp",
    "fresh_air_humidity",
    "chilled_water_supply_temp",
]


@pytest.mark.parametrize("value", [math.inf, -math.inf, math.nan])
@pytest.mark.parametrize("field", FIELDS)
def test_a_non_finite_reading_is_rejected(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        PredictReadingsIn.model_validate({field: value})


def test_finite_readings_pass_unchanged() -> None:
    """越界但有限的值照收：实时读数预填的草稿里本来就会有。"""
    reading = PredictReadingsIn.model_validate(
        {"workshop_temp_avg": 273305.0, "workshop_humidity_avg": 120.0}
    )
    assert reading.workshop_temp_avg == 273305.0
    assert reading.workshop_humidity_avg == 120.0
