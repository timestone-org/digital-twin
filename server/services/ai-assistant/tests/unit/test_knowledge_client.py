"""知识原文续读保持身份、窗口与不存在的恢复语义。"""

import httpx
import pytest

from ai_assistant.upstream.knowledge import (
    KnowledgeClient,
    KnowledgeUnavailable,
)
from lib.errors import AppError


async def test_removed_chunk_requires_retrieval_instead_of_retry() -> None:
    client = KnowledgeClient(base_url="http://knowledge.test", timeout_s=1)
    client.use_transport(
        httpx.MockTransport(
            lambda _request: httpx.Response(
                404,
                json={"code": 42317, "message": "知识块不存在", "data": None},
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
