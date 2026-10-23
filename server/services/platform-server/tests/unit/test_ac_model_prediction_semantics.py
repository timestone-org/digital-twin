"""已知达标状态、正时长支持集与前向评估的预测契约。"""

from dataclasses import replace
from datetime import timedelta

import pytest

from platform_server.apps.hvac.errors import ModelArtifactUnusable
from platform_server.apps.hvac.modeling.artifact import ModelBundle, load
from platform_server.apps.hvac.modeling.features import EpisodeSample
from platform_server.apps.hvac.modeling.training import train
from platform_server.apps.hvac.schemas import PredictIn
from platform_server.apps.hvac.services.ac_model_predictor import score_set
from unit.test_ac_model_features import TZ, UNITS
from unit.test_ac_model_training import BASE, sample


@pytest.fixture(scope="module")
def bundle() -> ModelBundle:
    samples: list[EpisodeSample] = []
    for index in range(80):
        source = sample(index)
        readings = {
            serial: {**values, "workshop_humidity_avg": 55.0}
            for serial, values in source.conditions.readings.items()
        }
        samples.append(
            replace(
                source, conditions=replace(source.conditions, readings=readings)
            )
        )
    trained = train(samples, units=UNITS, timezone=TZ, half_life_days=180.0)
    return load(
        trained.artifact.payload,
        digest=trained.artifact.digest,
        format_version=trained.artifact.format_version,
        trained_sklearn_version=trained.artifact.sklearn_version,
    )


def request(temperature: float) -> PredictIn:
    return PredictIn.model_validate(
        {
            "running_set": ["K11"],
            "at": BASE,
            "idle_minutes": 390,
            "readings": {
                "K11": {
                    "workshop_temp_avg": temperature,
                    "workshop_humidity_avg": 55.0,
                },
                "K12": {
                    "workshop_temp_avg": 25.0,
                    "workshop_humidity_avg": 55.0,
                },
            },
        }
    )


def test_known_noncompliant_start_cannot_be_predicted_as_instant(
    bundle: ModelBundle,
) -> None:
    found = score_set(bundle, ["K11"], payload=request(26.01))
    assert found.instant_probability == 0.0
    assert found.p50 >= 8.0 - 1e-9


def test_known_compliant_start_is_zero_even_at_the_band_edge(
    bundle: ModelBundle,
) -> None:
    found = score_set(bundle, ["K11"], payload=request(26.0))
    assert found.instant_probability == 1.0
    assert (found.p10, found.p50, found.p90) == (0.0, 0.0, 0.0)


def test_missing_positive_history_cannot_claim_zero_wait(
    bundle: ModelBundle,
) -> None:
    empty = replace(bundle, pooled=replace(bundle.pooled, duration_forest=None))
    with pytest.raises(ModelArtifactUnusable, match="非零时长"):
        score_set(empty, ["K11"], payload=request(26.01))


def test_future_answers_cannot_change_earlier_validation_predictions() -> None:
    samples = [sample(index) for index in range(40)]
    changed = [
        (
            replace(row, duration_minutes=55)
            if index >= 32 and row.duration_minutes > 0
            else row
        )
        for index, row in enumerate(samples)
    ]
    first = train(samples, units=UNITS, timezone=TZ, half_life_days=180.0)
    second = train(changed, units=UNITS, timezone=TZ, half_life_days=180.0)
    cutoff = BASE + timedelta(days=20)
    before = {
        row.started_at: row.p50 for row in first.oof if row.started_at < cutoff
    }
    after = {
        row.started_at: row.p50 for row in second.oof if row.started_at < cutoff
    }
    assert before
    assert before == after
