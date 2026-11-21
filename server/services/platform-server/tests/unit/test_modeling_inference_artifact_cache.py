"""工作进程只复用按固定元信息校验过的模型制品。"""

from dataclasses import replace

import pytest

from platform_server.apps.modeling.errors import (
    DeploymentUnservable,
    PredictRequestInvalid,
)
from platform_server.apps.modeling.services.artifact_store import seal
from platform_server.apps.modeling.services.inference_task import (
    ArtifactIdentity,
    RequiredArtifact,
    ScoreRows,
    score,
)
from unit.test_modeling_trees import NOISE, STEP, _built, _training


def test_worker_reuses_the_verified_forest_and_honours_metadata_changes() -> (
    None
):
    fitted = _built(n_estimators=17)
    frame = _training()
    fitted.run({"train": frame, "test": frame})
    artifact = seal(fitted.trained_estimator())
    identity = ArtifactIdentity(
        "models/qa", artifact.digest, artifact.format_version, artifact.runtime
    )
    serving = {
        "format_version": "1.0",
        "input_columns": [STEP, NOISE],
        "steps": [
            {
                "operator": "tree_regressor",
                "config": {"n_estimators": 17},
                "fitted": fitted.dump_fitted(),
            }
        ],
    }
    rows = ScoreRows(serving, [([0.0, 0.0], None), ([59.0, 0.0], None)])
    assert isinstance(score(rows, identity), RequiredArtifact)
    predictions = score(rows, identity, artifact.payload)
    assert predictions == pytest.approx([0.0, 100.0], abs=5)
    assert score(rows, identity) == predictions

    changed = replace(identity, version=identity.version + 1)
    assert isinstance(score(rows, changed), RequiredArtifact)
    assert isinstance(
        score(rows, changed, artifact.payload), DeploymentUnservable
    )
    assert score(rows, identity) == predictions

    invalid = ScoreRows(serving, [([25.0], None)])
    assert isinstance(score(invalid, identity), PredictRequestInvalid)
