"""开放模型请求运行真实算子时，API 事件循环始终可调度。"""

import sys
from collections.abc import Iterator
from contextlib import contextmanager
from types import CodeType, FrameType

import pytest
from conftest import AppContext

from integration.dataset_helpers import HTTP_OK
from integration.modeling_helpers import LOAD, TEMPERATURE, data_of
from integration.test_modeling_anomaly_models_api import bind_call_fakes
from integration.test_modeling_formula_preview import binary_version
from integration.test_modeling_open_api import DEPLOYMENTS, OPEN
from integration.test_modeling_rule_api import rule_service
from platform_server.apps.modeling.services import artifact_store
from platform_server.apps.modeling.services.serving import CompiledModel

pytestmark = pytest.mark.requires_postgres

__all__ = ["rule_service"]


@contextmanager
def main_loop_calls(*functions: CodeType) -> Iterator[list[str]]:
    """只观察处理 HTTP 的线程是否直接执行同步算子。Args: functions。"""
    calls: list[str] = []

    def profile(frame: FrameType, event: str, _argument: object) -> None:
        if event == "call" and frame.f_code in functions:
            calls.append(frame.f_code.co_qualname)

    before = sys.getprofile()
    sys.setprofile(profile)
    try:
        yield calls
    finally:
        sys.setprofile(before)


async def test_prediction_decodes_and_runs_the_binary_model_off_the_http_loop(
    app_context: AppContext,
) -> None:
    bind_call_fakes(app_context)
    client = app_context.client
    version = await binary_version(
        client,
        app_context.session,
        app_context.sessions,
        app_context.object_store,
    )
    deployed = await client.post(
        DEPLOYMENTS,
        json={
            "code": "isolated-tree",
            "name": "合成树",
            "model_version_id": version["id"],
        },
    )
    assert deployed.status_code == 201, deployed.text
    with main_loop_calls(
        artifact_store.load.__code__, CompiledModel.predict_many.__code__
    ) as calls:
        response = await client.post(
            f"{OPEN}/isolated-tree:predict",
            json={"rows": [{TEMPERATURE: 25.0, LOAD: 430.0}]},
        )
    assert response.status_code == HTTP_OK, response.text
    assert isinstance(data_of(response)["predictions"][0], (int, float))
    assert calls == []


async def test_decimal_rule_runs_off_the_http_loop(
    app_context: AppContext,
    rule_service: tuple[dict[str, object], dict[str, str]],
) -> None:
    deployment, headers = rule_service
    with main_loop_calls(CompiledModel.calculate_many.__code__) as calls:
        response = await app_context.client.post(
            f"{OPEN}/{deployment['code']}:calculate",
            json={"rows": [{"能耗": "0.30", "产量": "0.10"}]},
            headers=headers,
        )
    assert response.status_code == HTTP_OK, response.text
    assert data_of(response)["results"][0]["unit_consumption"] == "3"
    assert calls == []
