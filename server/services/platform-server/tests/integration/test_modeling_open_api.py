"""账号身份调用模型，验证真实预测、拒绝路径、配额与调用记录。"""

from typing import Any

import httpx
import pytest
from conftest import SignHeaders
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.modeling_helpers import (
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    HTTP_OK,
    LOAD,
    TEMPERATURE,
    code_of,
    data_of,
)
from integration.test_modeling_formula_seam import _trained_version
from platform_server.apps.modeling.models import ModelingCallLog

pytestmark = pytest.mark.requires_postgres

DEPLOYMENTS = "/api/v1/platform/modeling-deployments"
OPEN = "/api/v1/platform/open-models"

HTTP_BAD_REQUEST = 400
HTTP_UNAUTHORIZED = 401
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404

UNAUTHENTICATED = 40100
DEPLOYMENT_DISABLED = 41419
PREDICT_REQUEST_INVALID = 41423

# 一次预测的两个实参与手算出来的答案
SAMPLE_TEMPERATURE = 25.0
SAMPLE_LOAD = 430.0
EXPECTED = 2.0 * SAMPLE_TEMPERATURE + 3.0 * SAMPLE_LOAD + 5.0
# 训练区间之外的那个温度。⚠ 造数的温度是 20 起步逐行 +0.5，取一个远在外面的
FAR_OUTSIDE = 9999.0


async def _served(
    client: httpx.AsyncClient,
    session: AsyncSession,
    sessions: MakerSessions,
    code: str,
) -> tuple[dict[str, Any], dict[str, str]]:
    """训练并部署模型，返回部署与边缘账号身份。

    Args: client, session, sessions, code。
    """
    version = await _trained_version(client, session, sessions, code)
    created = await client.post(
        DEPLOYMENTS,
        json={
            "code": code,
            "model_version_id": version["id"],
            "name": f"{code} 服务",
        },
    )
    assert created.status_code == HTTP_CREATED, created.text
    deployment = dict(data_of(created))
    return deployment, dict(client.headers)


def _rows(temperature: float = SAMPLE_TEMPERATURE) -> dict[str, Any]:
    return {"rows": [{TEMPERATURE: temperature, LOAD: SAMPLE_LOAD}]}


async def test_an_account_gets_the_hand_computed_answer(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """使用账号来算，回来的数与手算逐位吻合。

    ⚠ 这是本期存在的理由那一条：接口通不等于算的是那个模型。
    """
    deployment, caller_headers = await _served(
        app_client, db_session, worker_sessions, "openone"
    )
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(),
        headers=caller_headers,
    )
    assert response.status_code == HTTP_OK, response.text
    answer = data_of(response)
    assert answer["predictions"][0] == pytest.approx(EXPECTED, rel=1e-6)
    assert answer["model"]["code"] == deployment["code"]


async def test_the_signature_comes_back_without_training_stats(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """对外那份签名剥掉了训练统计。

    ⚠ 训练区间的具体数值是训练数据的分布，属于内部信息（D8）。
    """
    deployment, caller_headers = await _served(
        app_client, db_session, worker_sessions, "opentwo"
    )
    response = await app_client.get(
        f"{OPEN}/{deployment['code']}", headers=caller_headers
    )
    assert response.status_code == HTTP_OK, response.text
    inputs = data_of(response)["inputs"]
    assert inputs
    assert all("training_stats" not in item for item in inputs)


@pytest.mark.parametrize("suffix", ["", ":predict", ":detect", ":calculate"])
async def test_all_model_calls_reject_untrusted_identity(
    app_client: httpx.AsyncClient, suffix: str
) -> None:
    response = await app_client.request(
        "POST" if suffix else "GET",
        f"{OPEN}/unknown{suffix}",
        json=_rows() if suffix else None,
        headers={"X-Auth-Sig": "", "X-Api-Key": "dtmk_legacy-key"},
    )
    assert response.status_code == HTTP_UNAUTHORIZED
    assert code_of(response) == UNAUTHENTICATED


@pytest.mark.parametrize("suffix", ["", ":predict", ":detect", ":calculate"])
async def test_model_calls_need_account_permission(
    app_client: httpx.AsyncClient, sign: SignHeaders, suffix: str
) -> None:
    response = await app_client.request(
        "POST" if suffix else "GET",
        f"{OPEN}/unknown{suffix}",
        json=_rows() if suffix else None,
        headers=sign(codes=("ac:view",)),
    )
    assert response.status_code == HTTP_FORBIDDEN


async def test_deployment_key_issuance_is_retired(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    deployment, _ = await _served(
        app_client, db_session, worker_sessions, "retired-keys"
    )
    response = await app_client.post(
        f"{DEPLOYMENTS}/{deployment['id']}/api-keys", json={"name": "不再签发"}
    )
    assert response.status_code == 410
    assert code_of(response) == 41430
    assert "用户 APIKey" in response.json()["message"]
    assert (
        data_of(
            await app_client.get(f"{DEPLOYMENTS}/{deployment['id']}/api-keys")
        )
        == []
    )


async def test_a_disabled_deployment_says_so_instead_of_answering(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """停用之后立刻 403，不是静默返回旧值。"""
    deployment, caller_headers = await _served(
        app_client, db_session, worker_sessions, "opensix"
    )
    patched = await app_client.patch(
        f"{DEPLOYMENTS}/{deployment['id']}", json={"is_enabled": False}
    )
    assert patched.status_code == HTTP_OK, patched.text
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(),
        headers=caller_headers,
    )
    assert response.status_code == HTTP_FORBIDDEN
    assert code_of(response) == DEPLOYMENT_DISABLED


async def test_too_many_rows_are_refused_with_the_limit_spelled_out(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """超过单次行数上限时说清楚上限是多少。"""
    deployment, caller_headers = await _served(
        app_client, db_session, worker_sessions, "openseven"
    )
    await app_client.patch(
        f"{DEPLOYMENTS}/{deployment['id']}", json={"max_rows_per_call": 2}
    )
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json={"rows": [{TEMPERATURE: 20.0, LOAD: 400.0}] * 3},
        headers=caller_headers,
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert code_of(response) == PREDICT_REQUEST_INVALID
    assert "2 行" in response.json()["message"]


async def test_a_value_outside_the_training_range_is_flagged(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """超出训练区间照样给数，但要标注出来。

    ⚠ 告警里**不说区间是多少**——只说「超了」。
    """
    deployment, caller_headers = await _served(
        app_client, db_session, worker_sessions, "openeight"
    )
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(FAR_OUTSIDE),
        headers=caller_headers,
    )
    assert response.status_code == HTTP_OK, response.text
    answer = data_of(response)
    assert answer["predictions"][0] is not None
    kinds = [item["kind"] for item in answer["warnings"]]
    assert "out_of_training_range" in kinds
    assert str(FAR_OUTSIDE) not in response.text


async def test_an_unknown_code_is_a_plain_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    """没有这个服务就是 404，不透露任何别的东西。"""
    response = await app_client.post(
        f"{OPEN}/there-is-no-such-thing:predict",
        json=_rows(),
        headers={"X-Api-Key": "dtmk_whatever-this-is-not-real"},
    )
    assert response.status_code == HTTP_NOT_FOUND


async def test_a_deployment_can_be_taken_down(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """删掉服务之后那个 URL 立刻 404。"""
    deployment, caller_headers = await _served(
        app_client, db_session, worker_sessions, "openten"
    )
    removed = await app_client.delete(f"{DEPLOYMENTS}/{deployment['id']}")
    assert removed.status_code == HTTP_NO_CONTENT, removed.text
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(),
        headers=caller_headers,
    )
    assert response.status_code == HTTP_NOT_FOUND


async def test_a_successful_call_lands_in_the_stats(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """算过一次之后，调用量里就有这一天的一笔。

    ⚠ 记录里只有行数、耗时与状态码——**没有入参也没有出参**：那是业务数据，
    可能含敏感值，而且体积会压垮这张表（防线 ⑫）。
    """
    deployment, caller_headers = await _served(
        app_client, db_session, worker_sessions, "openeleven"
    )
    await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(),
        headers=caller_headers,
    )
    response = await app_client.get(
        f"{DEPLOYMENTS}/{deployment['id']}/call-stats"
    )
    assert response.status_code == HTTP_OK, response.text
    stats = data_of(response)
    assert stats[0]["total"] == 1
    assert stats[0]["failed"] == 0
    assert str(SAMPLE_LOAD) not in response.text


async def test_account_calls_do_not_reference_deployment_keys(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    deployment, _ = await _served(
        app_client, db_session, worker_sessions, "call-owner"
    )
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict", json=_rows()
    )
    assert response.status_code == HTTP_OK
    rows = list((await db_session.scalars(select(ModelingCallLog))).all())
    assert len(rows) == 1
    assert rows[0].api_key_id is None


async def test_quota_is_independent_for_each_account_and_deployment(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    sign: SignHeaders,
) -> None:
    deployment, _ = await _served(
        app_client, db_session, worker_sessions, "quota-one"
    )
    await app_client.patch(
        f"{DEPLOYMENTS}/{deployment['id']}", json={"rate_limit_per_minute": 1}
    )
    second = await app_client.post(
        DEPLOYMENTS,
        json={
            "code": "quota-two",
            "name": "另一个服务",
            "model_version_id": deployment["model_version_id"],
            "rate_limit_per_minute": 1,
        },
    )
    assert second.status_code == HTTP_CREATED
    url = f"{OPEN}/{deployment['code']}:predict"
    assert (await app_client.post(url, json=_rows())).status_code == HTTP_OK
    assert (await app_client.post(url, json=_rows())).status_code == 429
    other = sign(codes=("modeling:view",))
    assert (
        await app_client.post(url, json=_rows(), headers=other)
    ).status_code == HTTP_OK
    assert (
        await app_client.post(f"{OPEN}/quota-two:predict", json=_rows())
    ).status_code == HTTP_OK
