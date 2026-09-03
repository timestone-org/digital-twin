"""对外推理面的端到端：开服务 → 铸钥匙 → 第三方带着钥匙来算数。

⚠ 造的数据是严格线性的 `能耗 = 2×温度 + 3×负荷 + 5`，于是「接口通了」不等于
「算的是那个模型」这件事能被真正断言：回来的数要与手算逐位吻合。
⚠ 这一组另一半盯的是**拒绝**：没钥匙、错钥匙、撤销过的钥匙、停用的服务、
超行数——每一种都要给出各自的状态码，而理由里一个字都不许多说
（docs/MODELING_PLATFORM_DESIGN.md D15）。
"""

from typing import Any

import httpx
import pytest
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

pytestmark = pytest.mark.requires_postgres

DEPLOYMENTS = "/api/v1/platform/modeling-deployments"
OPEN = "/api/v1/platform/open-models"

HTTP_BAD_REQUEST = 400
HTTP_UNAUTHORIZED = 401
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404

API_KEY_INVALID = 41421
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
) -> tuple[dict[str, Any], str]:
    """训一个模型、开成对外服务、铸一把钥匙。回部署与明文钥匙。

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
    minted = await client.post(
        f"{DEPLOYMENTS}/{deployment['id']}/api-keys",
        json={"name": "MES 生产系统"},
    )
    assert minted.status_code == HTTP_CREATED, minted.text
    return deployment, str(data_of(minted)["plaintext"])


def _rows(temperature: float = SAMPLE_TEMPERATURE) -> dict[str, Any]:
    return {"rows": [{TEMPERATURE: temperature, LOAD: SAMPLE_LOAD}]}


async def test_a_third_party_with_a_key_gets_the_hand_computed_answer(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """带着钥匙来算，回来的数与手算逐位吻合。

    ⚠ 这是本期存在的理由那一条：接口通不等于算的是那个模型。
    """
    deployment, key = await _served(
        app_client, db_session, worker_sessions, "openone"
    )
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(),
        headers={"X-Api-Key": key},
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
    deployment, key = await _served(
        app_client, db_session, worker_sessions, "opentwo"
    )
    response = await app_client.get(
        f"{OPEN}/{deployment['code']}", headers={"X-Api-Key": key}
    )
    assert response.status_code == HTTP_OK, response.text
    inputs = data_of(response)["inputs"]
    assert inputs
    assert all("training_stats" not in item for item in inputs)


async def test_a_call_without_a_key_is_turned_away(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """不带钥匙一律 401，且理由里只有四个字。"""
    deployment, _ = await _served(
        app_client, db_session, worker_sessions, "openthree"
    )
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict", json=_rows()
    )
    assert response.status_code == HTTP_UNAUTHORIZED
    assert code_of(response) == API_KEY_INVALID
    assert response.json()["message"] == "密钥无效"


async def test_a_wrong_key_gets_the_very_same_refusal(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """错钥匙与没钥匙给的是同一句话。

    ⚠ 区分开等于送一个枚举接口（防线 ⑪）。
    """
    deployment, _ = await _served(
        app_client, db_session, worker_sessions, "openfour"
    )
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(),
        headers={"X-Api-Key": "dtmk_this-one-is-not-real-at-all"},
    )
    assert response.status_code == HTTP_UNAUTHORIZED
    assert response.json()["message"] == "密钥无效"


async def test_a_revoked_key_stops_working_at_once(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """撤销立刻生效。"""
    deployment, key = await _served(
        app_client, db_session, worker_sessions, "openfive"
    )
    keys = data_of(
        await app_client.get(f"{DEPLOYMENTS}/{deployment['id']}/api-keys")
    )
    revoked = await app_client.post(
        f"{DEPLOYMENTS}/{deployment['id']}/api-keys/{keys[0]['id']}:revoke"
    )
    assert revoked.status_code == HTTP_OK, revoked.text
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(),
        headers={"X-Api-Key": key},
    )
    assert response.status_code == HTTP_UNAUTHORIZED


async def test_a_disabled_deployment_says_so_instead_of_answering(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """停用之后立刻 403，不是静默返回旧值。"""
    deployment, key = await _served(
        app_client, db_session, worker_sessions, "opensix"
    )
    patched = await app_client.patch(
        f"{DEPLOYMENTS}/{deployment['id']}", json={"is_enabled": False}
    )
    assert patched.status_code == HTTP_OK, patched.text
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(),
        headers={"X-Api-Key": key},
    )
    assert response.status_code == HTTP_FORBIDDEN
    assert code_of(response) == DEPLOYMENT_DISABLED


async def test_too_many_rows_are_refused_with_the_limit_spelled_out(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """超过单次行数上限时说清楚上限是多少。"""
    deployment, key = await _served(
        app_client, db_session, worker_sessions, "openseven"
    )
    await app_client.patch(
        f"{DEPLOYMENTS}/{deployment['id']}", json={"max_rows_per_call": 2}
    )
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json={"rows": [{TEMPERATURE: 20.0, LOAD: 400.0}] * 3},
        headers={"X-Api-Key": key},
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
    deployment, key = await _served(
        app_client, db_session, worker_sessions, "openeight"
    )
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(FAR_OUTSIDE),
        headers={"X-Api-Key": key},
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


async def test_the_key_list_never_shows_a_plaintext(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """密钥列表里一把明文都没有，只有前缀。

    ⚠ 明文只在铸出来那一次的回执里出现。
    """
    deployment, key = await _served(
        app_client, db_session, worker_sessions, "opennine"
    )
    response = await app_client.get(
        f"{DEPLOYMENTS}/{deployment['id']}/api-keys"
    )
    assert response.status_code == HTTP_OK, response.text
    listed = data_of(response)
    assert key not in response.text
    assert listed[0]["key_prefix"] == key[: len(listed[0]["key_prefix"])]


async def test_a_deployment_can_be_taken_down(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """删掉服务之后那个 URL 立刻 404。"""
    deployment, key = await _served(
        app_client, db_session, worker_sessions, "openten"
    )
    removed = await app_client.delete(f"{DEPLOYMENTS}/{deployment['id']}")
    assert removed.status_code == HTTP_NO_CONTENT, removed.text
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(),
        headers={"X-Api-Key": key},
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
    deployment, key = await _served(
        app_client, db_session, worker_sessions, "openeleven"
    )
    await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(),
        headers={"X-Api-Key": key},
    )
    response = await app_client.get(
        f"{DEPLOYMENTS}/{deployment['id']}/call-stats"
    )
    assert response.status_code == HTTP_OK, response.text
    stats = data_of(response)
    assert stats[0]["total"] == 1
    assert stats[0]["failed"] == 0
    assert str(SAMPLE_LOAD) not in response.text


async def test_using_a_key_stamps_when_it_was_last_used(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """用过一次之后，密钥上留下「最后用过」。

    ⚠ 每分钟最多写一次：每次调用都写会把那一行变成热点，而它的用途只是
    「这把钥匙还在不在用」。
    """
    deployment, key = await _served(
        app_client, db_session, worker_sessions, "openthirteen"
    )
    before = data_of(
        await app_client.get(f"{DEPLOYMENTS}/{deployment['id']}/api-keys")
    )
    assert before[0]["last_used_at"] is None
    await app_client.post(
        f"{OPEN}/{deployment['code']}:predict",
        json=_rows(),
        headers={"X-Api-Key": key},
    )
    after = data_of(
        await app_client.get(f"{DEPLOYMENTS}/{deployment['id']}/api-keys")
    )
    assert after[0]["last_used_at"] is not None
