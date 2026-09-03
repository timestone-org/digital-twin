"""树回归：通道 B 的第一批算子。

⚠ 这一组盯两件事：产物真的从子进程里带得出来（否则发布时无从落库），以及
**列序跟着产物一起存**——产物自己不记列名、投影按位置取，列序对不上时预测照样
算得出来，只是每一列都错位了。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.frame import (
    ROLE_FEATURE,
    ROLE_TARGET,
)
from platform_server.apps.modeling.operators.payloads import ModelPayload
from platform_server.apps.modeling.services.artifact_store import (
    load,
    runtime_versions,
    seal,
)
from platform_server.apps.modeling.services.node_task import (
    NodePayload,
    run_node_payload,
)

STEP = "台阶"
NOISE = "噪声"
TARGET = "产量"
ROWS = 60


def _training() -> Frame:
    """目标是台阶函数——线性拟不好、树拟得很好。"""
    rows = tuple(
        (
            float(index),
            float((index * 7) % 3),
            0.0 if index < ROWS // 2 else 100.0,
        )
        for index in range(ROWS)
    )
    return Frame(
        columns=(
            FrameColumn(key=STEP, name=STEP, dtype="number", role=ROLE_FEATURE),
            FrameColumn(
                key=NOISE, name=NOISE, dtype="number", role=ROLE_FEATURE
            ),
            FrameColumn(
                key=TARGET, name=TARGET, dtype="number", role=ROLE_TARGET
            ),
        ),
        rows=rows,
    )


def _built(**config: Any) -> Any:
    operator, _ = registry.build("tree_regressor", config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    return operator


def _payload(operator: Any, frame: Frame) -> ModelPayload:
    found = operator.run({"train": frame, "test": frame})["model"]
    assert isinstance(found, ModelPayload)
    return found


def test_a_step_function_is_fitted_well() -> None:
    """台阶函数树拟得住——这正是它相对线性回归的用处。"""
    frame = _training()
    operator = _built(n_estimators=20)
    operator.run({"train": frame, "test": frame})
    got = operator.predict_rows(frame)
    assert got[0] == pytest.approx(0.0, abs=5.0)
    assert got[-1] == pytest.approx(100.0, abs=5.0)


def test_the_payload_says_it_goes_down_the_binary_channel() -> None:
    """模型描述明说走二进制通道，且 `fitted` 里没有拟合参数。"""
    payload = _payload(_built(n_estimators=10), _training())
    assert payload.serving_channel == "binary"
    assert "coef" not in payload.fitted


def test_the_column_order_travels_with_the_model() -> None:
    """列序跟着模型存下来。

    ⚠ 产物自己不记列名，投影按位置取——列序对不上时预测照样算得出来，只是
    每一列都错位了。
    """
    operator = _built(n_estimators=10)
    operator.run({"train": _training(), "test": _training()})
    assert (operator.dump_fitted() or {})["feature_keys"] == [STEP, NOISE]


def test_a_duplicated_column_order_is_refused() -> None:
    """列序里有重复时当场拒掉。"""
    with pytest.raises(OperatorError, match="重复"):
        _built().load_fitted({"feature_keys": [STEP, STEP]})


def test_the_subprocess_hands_back_a_sealed_artifact() -> None:
    """子进程回传的是**封存件**，不是估计器对象。

    ⚠ 估计器自己就是要序列化的那个东西，跨不回来；封存件是纯字节，跨得回来。
    """
    frame = _training()
    result = run_node_payload(
        NodePayload(
            operator="tree_regressor",
            config={"n_estimators": 10},
            inputs={"train": frame, "test": frame},
            tz_offset_minutes=0,
            split_plan=None,
        )
    )
    assert result.artifact is not None
    assert result.artifact.size_bytes > 0
    assert result.artifact.runtime == runtime_versions()


def test_a_pure_json_operator_hands_back_no_artifact() -> None:
    """通道 A 那些算子一个字节都不产。"""
    frame = _training()
    result = run_node_payload(
        NodePayload(
            operator="linear_regression",
            config={},
            inputs={"train": frame, "test": frame},
            tz_offset_minutes=0,
            split_plan=None,
        )
    )
    assert result.artifact is None


def test_an_adopted_estimator_predicts_the_same() -> None:
    """把产物加载回来装上，预测与训练那一侧一模一样。"""
    frame = _training()
    trained = _built(n_estimators=10)
    trained.run({"train": frame, "test": frame})
    sealed = seal(trained.trained_estimator())

    served = _built(n_estimators=10)
    served.load_fitted(trained.dump_fitted() or {})
    served.attach_estimator(
        load(
            sealed.payload,
            digest=sealed.digest,
            format_version=sealed.format_version,
            runtime=sealed.runtime,
        )
    )
    assert served.predict_rows(frame) == trained.predict_rows(frame)


def test_a_model_without_its_artifact_refuses_to_predict() -> None:
    """只回灌了列序、没装估计器时说清楚，不给一串 0。"""
    served = _built()
    served.load_fitted({"feature_keys": [STEP, NOISE]})
    with pytest.raises(OperatorError, match="还没有拟合结果"):
        served.predict_rows(_training())
