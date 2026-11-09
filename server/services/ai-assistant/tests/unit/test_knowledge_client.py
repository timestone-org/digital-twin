"""知识库客户端的失败处置：4xx 要说出真实状态，不能一律读成「暂时不可用」。

守的是「填错库 id，助手告诉用户知识库挂了」：404 与 503 在模型眼里是两件事，
前者该换个 id，后者才该稍后再试。
"""

import uuid

import httpx
import pytest

from ai_assistant.upstream import KnowledgeClient, KnowledgeUnavailable


def _client(status: int, body: dict[str, object]) -> KnowledgeClient:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=body)

    client = KnowledgeClient(base_url="http://knowledge.test", timeout_s=5)
    client.use_transport(httpx.MockTransport(handler))
    return client


async def test_a_missing_base_says_so_instead_of_sounding_down() -> None:
    client = _client(404, {"code": 40003, "message": "知识库不存在"})
    with pytest.raises(KnowledgeUnavailable) as caught:
        await client.search({}, str(uuid.uuid4()), {"query": "甲"})
    assert "404" in caught.value.message
    assert "知识库不存在" in caught.value.message
    assert caught.value.upstream_status == 404


async def test_a_server_error_still_reads_as_unavailable() -> None:
    client = _client(503, {})
    with pytest.raises(KnowledgeUnavailable) as caught:
        await client.search({}, str(uuid.uuid4()), {"query": "甲"})
    assert caught.value.message == "知识库暂时不可用"
    assert caught.value.upstream_status == 503
