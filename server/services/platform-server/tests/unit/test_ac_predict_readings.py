"""试算读数的入参边界：温度按训练同一可信区间拦，非有限值一律拒绝。"""

import math

import pytest
from pydantic import ValidationError

from platform_server.apps.hvac.schemas import PredictReadingsIn


@pytest.mark.parametrize("value", [-265.5, 273305.0, math.inf, math.nan])
@pytest.mark.parametrize(
    "field",
    ["workshop_temp_avg", "fresh_air_temp", "chilled_water_supply_temp"],
)
def test_an_implausible_temperature_is_rejected(
    field: str, value: float
) -> None:
    with pytest.raises(ValidationError):
        PredictReadingsIn.model_validate({field: value})


@pytest.mark.parametrize("value", [math.inf, -math.inf, math.nan])
@pytest.mark.parametrize(
    "field", ["workshop_humidity_avg", "fresh_air_humidity"]
)
def test_a_non_finite_humidity_is_rejected(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        PredictReadingsIn.model_validate({field: value})


def test_plausible_readings_pass_unchanged() -> None:
    """边界值与超过 100 的湿度照收：实时读数预填的草稿里本来就会有。"""
    reading = PredictReadingsIn.model_validate(
        {"workshop_temp_avg": -20.0, "fresh_air_temp": 60.0}
        | {"workshop_humidity_avg": 120.0}
    )
    assert reading.workshop_temp_avg == -20.0
    assert reading.workshop_humidity_avg == 120.0
