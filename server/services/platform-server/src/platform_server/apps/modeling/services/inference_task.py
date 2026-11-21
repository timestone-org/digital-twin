"""在推理工作进程内核验、缓存及运行已发布模型。"""

import json
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache

from lib.errors import AppError
from platform_server.apps.modeling.errors import (
    DeploymentUnservable,
    PredictRequestInvalid,
)
from platform_server.apps.modeling.operators import OperatorError
from platform_server.apps.modeling.services.artifact_io import ArtifactCache
from platform_server.apps.modeling.services.artifact_store import (
    ArtifactRejected,
    load,
)
from platform_server.apps.modeling.services.serving import compile_model

type Prediction = list[float | None]


@dataclass(frozen=True)
class ArtifactIdentity:
    """版本固定的制品引用与校验参数。"""

    key: str
    digest: str
    version: int
    runtime: dict[str, str]

    def cache_key(self) -> str:
        """为相同摘要和运行时约束生成稳定键。"""
        return json.dumps(
            [self.digest, self.version, self.runtime], sort_keys=True
        )


@dataclass(frozen=True)
class ScoreRows:
    """无需数据库连接或网络凭据的预测批次。"""

    serving: dict[str, object]
    rows: list[tuple[list[float | None], datetime | None]]


@dataclass(frozen=True)
class RequiredArtifact:
    """工作进程的缓存尚未装入该版本。"""


@lru_cache(maxsize=1)
def _models() -> ArtifactCache:
    """每个工作进程只持有一份有界模型缓存。"""
    return ArtifactCache()


def score(
    rows: ScoreRows,
    identity: ArtifactIdentity | None,
    payload: bytes | None = None,
) -> Prediction | RequiredArtifact | AppError:
    """对一批输入运行冻结模型。Args: rows, identity, payload。"""
    try:
        estimator: object | None = None
        if identity is not None:
            key = identity.cache_key()
            estimator = _models().get(key)
            if estimator is None:
                if payload is None:
                    return RequiredArtifact()
                estimator = load(
                    payload,
                    digest=identity.digest,
                    format_version=identity.version,
                    runtime=identity.runtime,
                )
                _models().put(key, estimator)
        compiled = compile_model(rows.serving, estimator=estimator)
    except (ArtifactRejected, OperatorError) as error:
        return DeploymentUnservable(str(error))
    try:
        return compiled.predict_many(rows.rows)
    except OperatorError as error:
        return PredictRequestInvalid(str(error))
