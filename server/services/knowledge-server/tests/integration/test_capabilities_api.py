"""能力面：没配任何模型档时也必须答得出来，而不是 5xx。"""

import httpx

from knowledge_server.app import build_app
from knowledge_server.settings import API_PREFIX

PATH = f"{API_PREFIX}/capabilities"


async def test_capabilities_answers_without_any_model(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ 前端靠它决定摆不摆知识库入口，一个 5xx 会被读成「后端坏了」，
    于是本该干净缺席的场合变成了一条红色告警。"""
    response = await app_client.get(PATH)
    assert response.status_code == httpx.codes.OK
    body = response.json()
    assert body["code"] == 0
    assert body["data"]["is_embedding_enabled"] is False
    assert body["data"]["is_model_enabled"] is False
    # ⚠ 没接重排时如实说「没接」并说得出为什么，而不是干脆不提这一路
    assert body["data"]["rerank"]["is_enabled"] is False
    assert body["data"]["rerank"]["reason"]


async def test_capabilities_names_the_two_lanes(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ 两路都没有回退档了（ADR-0045），但界面仍要说得出检索是怎么做的：
    这两格恒为 pgvector 与 trgm，而没接嵌入档时也不改口——改口的话，
    「这套部署的检索是怎么做的」与「此刻能不能用」会被混成一句话。"""
    response = await app_client.get(PATH)
    index = response.json()["data"]["index"]
    assert index["vector"] == "pgvector"
    assert index["keyword"] == "trgm"
    assert index["reason"] == ""


async def test_anonymous_is_rejected(settings: object) -> None:
    """⚠ 能力面同样要认人：它泄露的是「这套部署接了什么」。"""
    transport = httpx.ASGITransport(
        app=build_app(settings)  # pyright: ignore[reportArgumentType]
    )
    async with httpx.AsyncClient(
        transport=transport, base_url="http://knowledge-test"
    ) as client:
        response = await client.get(PATH)
    assert response.status_code == httpx.codes.UNAUTHORIZED
