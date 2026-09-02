"""探一次端点：拿密钥打 `/models`，把结果收成一句话，密钥与地址不出门。

守的是三档最常见的配错各有各的说法（密钥错、地址少了版本段、连不上），
以及应答不是 OpenAI 口径时不许把它读成「通了」。
"""

import httpx
import pytest

from platform_server.apps.llm_providers.services import probe_endpoint

BASE_URL = "https://endpoint/compatible-mode/v1"
KEY = "sk-super-secret"


def _transport(
    handler: object,
) -> httpx.MockTransport:
    return httpx.MockTransport(handler)  # pyright: ignore[reportArgumentType]


async def _probe(handler: object) -> tuple[bool, str, list[str]]:
    made = await probe_endpoint(
        base_url=BASE_URL,
        api_key=KEY,
        timeout_s=2.0,
        transport=_transport(handler),
    )
    return made.is_ok, made.message, made.model_names


async def test_a_healthy_endpoint_reports_its_models() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={"data": [{"id": "qwen-plus"}, {"id": "qwen-max"}, {}]},
        )

    is_ok, message, names = await _probe(handle)
    assert is_ok is True
    assert names == ["qwen-max", "qwen-plus"]
    assert "2" in message
    assert seen[0].url.path == "/compatible-mode/v1/models"
    assert seen[0].headers["Authorization"] == f"Bearer {KEY}"


@pytest.mark.parametrize(
    ("status", "expected"),
    [(401, "密钥"), (403, "密钥"), (404, "/models"), (500, "500")],
    ids=["unauthorized", "forbidden", "not-found", "server-error"],
)
async def test_each_failure_status_gets_its_own_words(
    status: int, expected: str
) -> None:
    def handle(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": "x"})

    is_ok, message, _ = await _probe(handle)
    assert is_ok is False
    assert expected in message
    assert KEY not in message
    assert BASE_URL not in message


async def test_a_non_openai_body_is_not_mistaken_for_success() -> None:
    def handle(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>login</html>")

    is_ok, message, _ = await _probe(handle)
    assert is_ok is False
    assert "口径" in message


async def test_an_unreachable_endpoint_says_so() -> None:
    def handle(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    is_ok, message, _ = await _probe(handle)
    assert is_ok is False
    assert "连不上" in message


async def test_a_timeout_says_so() -> None:
    def handle(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    is_ok, message, _ = await _probe(handle)
    assert is_ok is False
    assert "超时" in message
