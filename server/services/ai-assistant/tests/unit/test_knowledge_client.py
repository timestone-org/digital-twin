"""知识库客户端的失败处置：4xx 要说出真实状态，不能一律读成「暂时不可用」。

守的是「填错库 id，助手告诉用户知识库挂了」：404 与 503 在模型眼里是两件事，
前者该换个 id，后者才该稍后再试。
"""

import uuid

import httpx
import pytest

from ai_assistant.upstream import KnowledgeClient, KnowledgeUnavailable
from lib.errors import AppError


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


async def test_removed_chunk_requires_retrieval_instead_of_retry() -> None:
    client = KnowledgeClient(base_url="http://knowledge.test", timeout_s=1)
    client.use_transport(
        httpx.MockTransport(
            lambda _request: httpx.Response(
                404,
                json={"code": 42318, "message": "知识块不存在", "data": None},
            )
        )
    )
    with pytest.raises(AppError, match="重新检索") as caught:
        await client.read_chunk({}, "base", "chunk")
    assert caught.value.http_status == 404
    await client.close()


async def test_chunk_read_keeps_the_requested_window_and_identity() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path.endswith("/knowledge-bases/base/chunks/chunk")
        assert dict(request.url.params) == {"offset": "1200", "limit": "400"}
        assert request.headers["X-Auth-User-Id"] == "caller"
        assert request.headers["traceparent"]
        return httpx.Response(
            200,
            json={
                "data": {"text": "原文", "next_offset": None, "has_more": False}
            },
        )

    client = KnowledgeClient(base_url="http://knowledge.test", timeout_s=1)
    client.use_transport(httpx.MockTransport(handler))
    result = await client.read_chunk(
        {"X-Auth-User-Id": "caller"}, "base", "chunk", (1200, 400)
    )
    assert result == {"text": "原文", "next_offset": None, "has_more": False}
    await client.close()


@pytest.mark.parametrize(
    "body", [{"code": {}}, {"detail": "Not Found"}, {"code": 50000}, []]
)
async def test_unknown_404_is_not_mistaken_for_a_deleted_object(
    body: object,
) -> None:
    client = KnowledgeClient(base_url="http://knowledge.test", timeout_s=1)
    client.use_transport(
        httpx.MockTransport(lambda _request: httpx.Response(404, json=body))
    )
    with pytest.raises(KnowledgeUnavailable):
        await client.read_chunk({}, "base", "chunk")
    await client.close()
