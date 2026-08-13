"""权限码目录客户端：解析、以及**取不到时拒绝**。

⚠ 这份用例守的是 CONTEXT.md §7 那条 fail-closed：auth-server 不可达时登记
必须被拒。放行的话，一次 auth 抖动就会让一个声明未经校验的主题永久留在库里，
而登记是一次性动作、没有第二次校验的机会。
"""

import httpx
import pytest
from realtime_hub.apps.channel.errors import CodeCatalogUnavailable
from realtime_hub.apps.channel.services import CodeCatalog

BASE = "http://auth-test"


def _catalog(handler: object) -> CodeCatalog:
    catalog = CodeCatalog(base_url=BASE, service_key="k" * 32, timeout_s=1.0)
    # 换掉传输层而不是打网络：要验的是解析与失败处置，不是 httpx 本身
    catalog._transport = httpx.MockTransport(handler)  # type: ignore[attr-defined]  # 测试注入
    return catalog


async def test_parses_the_envelope() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Service-Key"] == "k" * 32
        return httpx.Response(200, json={"data": {"codes": ["a:b", "c:d"]}})

    assert await _catalog(handler).known_codes() == frozenset({"a:b", "c:d"})


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, json={"data": {"codes": []}}),
        httpx.Response(200, json={"nope": 1}),
        httpx.Response(200, json={"data": {"codes": "not a list"}}),
        httpx.Response(200, text="not json"),
    ],
)
async def test_any_unusable_answer_fails_closed(
    response: httpx.Response,
) -> None:
    # ⚠ 四种坏答案都必须抛，不能退化成空集：空集会让**所有**登记被判成
    # 「码不存在」，而那看着像业务错误、不像故障
    with pytest.raises(CodeCatalogUnavailable):
        await _catalog(lambda _request: response).known_codes()


async def test_a_dead_auth_server_fails_closed() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    with pytest.raises(CodeCatalogUnavailable):
        await _catalog(handler).known_codes()
