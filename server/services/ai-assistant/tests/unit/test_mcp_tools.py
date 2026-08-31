"""外部 MCP 那一路来源（ADR-0031）。

守四件事，每一件漏了都不报错、只在现场露馅：一路挂掉不许连累其余（断路器按
server 分）、写操作默认**不出现在清单里**而不是「调了再拒」、工具名要能过订阅
账号那一路的线名往返、以及外部报来的坏形状不许把整路带塌。
"""

from collections.abc import Callable

import httpx
import pytest

from ai_assistant.apps.chat.services.intent.select import specs_for
from ai_assistant.apps.chat.services.tools.providers.mcp import (
    BadToolName,
    McpTools,
    canonical_name,
    split_name,
)
from ai_assistant.apps.chat.services.tools.registry import (
    DuplicateTool,
    ProviderDeps,
    build_registry,
    registry_of,
)
from ai_assistant.llm.codex import wire_names
from ai_assistant.upstream import McpCatalog, McpClient, McpServer
from lib.resilience import CircuitBreaker

Handler = Callable[[httpx.Request], httpx.Response]

WEATHER = McpServer(name="weather", url="http://weather.test/mcp")
NOTES = McpServer(name="notes", url="http://notes.test/mcp")


def _tool(name: str, *, is_read_only: bool = True) -> dict[str, object]:
    body: dict[str, object] = {
        "name": name,
        "description": "拿个数",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    }
    if is_read_only:
        body["annotations"] = {"readOnlyHint": True}
    return body


def _reply(tools: list[dict[str, object]]) -> httpx.Response:
    return httpx.Response(
        200, json={"jsonrpc": "2.0", "id": 1, "result": {"tools": tools}}
    )


def _catalog(
    handler: Handler, servers: tuple[McpServer, ...] = (WEATHER,)
) -> McpCatalog:
    client = McpClient(timeout_s=1)
    client.use_transport(httpx.MockTransport(handler))
    return McpCatalog(
        client=client,
        servers=servers,
        tokens={},
        breakers={
            one.name: CircuitBreaker(
                name=f"mcp:{one.name}", failure_threshold=2, reset_after_s=60
            )
            for one in servers
        },
    )


async def test_a_read_only_tool_shows_up_under_a_dotted_name() -> None:
    catalog = _catalog(lambda _request: _reply([_tool("forecast")]))
    await catalog.refresh()
    specs = McpTools(catalog=catalog).specs()
    assert [one.name for one in specs] == ["mcp.weather.forecast"]
    assert specs[0].runs_on == "server"


async def test_a_write_tool_stays_out_of_the_listing_until_allowed() -> None:
    """⚠ 是「不出现」而不是「调了被拒」：模型看得见就会调，拦一次换一次往返。"""
    catalog = _catalog(
        lambda _request: _reply([_tool("set_alert", is_read_only=False)])
    )
    await catalog.refresh()
    assert McpTools(catalog=catalog).specs() == ()
    allowed = McpTools(
        catalog=catalog, write_allowed=frozenset({"mcp.weather.set_alert"})
    )
    assert [one.name for one in allowed.specs()] == ["mcp.weather.set_alert"]


async def test_a_tool_without_the_read_only_hint_counts_as_a_write() -> None:
    """说不清就当写操作：放行的代价不可逆，拦下的只是白名单补一行。"""
    catalog = _catalog(
        lambda _request: _reply([_tool("wipe", is_read_only=False)])
    )
    await catalog.refresh()
    assert McpTools(catalog=catalog).specs() == ()


async def test_one_dead_server_does_not_take_the_others_with_it() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "weather" in str(request.url):
            raise httpx.ConnectError("down")
        return _reply([_tool("list")])

    catalog = _catalog(handler, servers=(WEATHER, NOTES))
    await catalog.refresh()
    names = [one.name for one in McpTools(catalog=catalog).specs()]
    assert names == ["mcp.notes.list"]


async def test_a_dead_servers_breaker_opens_and_the_others_stay_closed() -> (
    None
):
    """⚠ 断路器按 server 分：共用一个的话，一路挂掉会把其余几路一起短路。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if "weather" in str(request.url):
            raise httpx.ConnectError("down")
        return _reply([_tool("list")])

    catalog = _catalog(handler, servers=(WEATHER, NOTES))
    await catalog.refresh()
    await catalog.refresh()
    assert not catalog.breakers["weather"].allow()
    assert catalog.breakers["notes"].allow()


async def test_a_broken_row_is_dropped_and_the_rest_survive() -> None:
    """外部报来的坏形状不许把整路带塌。"""
    catalog = _catalog(
        lambda _request: _reply([{"no": "name"}, _tool("forecast")])
    )
    await catalog.refresh()
    names = [one.name for one in McpTools(catalog=catalog).specs()]
    assert names == ["mcp.weather.forecast"]


async def test_running_an_unlisted_tool_is_refused() -> None:
    """⚠ `run` 再查一次白名单：模型可能从历史里翻出一个旧配置下发过的名字。"""
    catalog = _catalog(
        lambda _request: _reply([_tool("set_alert", is_read_only=False)])
    )
    await catalog.refresh()
    with pytest.raises(LookupError):
        await McpTools(catalog=catalog).run("mcp.weather.set_alert", {})


def test_names_use_dots_so_the_subscription_route_can_round_trip() -> None:
    """⚠ ADR-0031 决策三写的 `mcp__a__b` 是错的：`from_wire` 把 `__` 换回点号，
    那样的名字往返之后对不上，现象是订阅账号档上这一批整批派发失败。"""
    name = canonical_name("weather", "get_forecast")
    assert name == "mcp.weather.get_forecast"
    assert wire_names.from_wire(wire_names.to_wire(name)) == name


def test_a_name_with_double_underscore_is_refused() -> None:
    """它是订阅账号那一路给点号用的替身，混进规范名就换不回来了。"""
    with pytest.raises(BadToolName):
        canonical_name("weather", "get__forecast")


def test_a_name_with_a_dot_is_refused() -> None:
    with pytest.raises(BadToolName):
        canonical_name("wea.ther", "forecast")


def test_split_only_claims_its_own_names() -> None:
    assert split_name("mcp.weather.forecast") == ("weather", "forecast")
    assert split_name("points.search") is None
    assert split_name("mcp.weather") is None


async def test_the_mcp_specs_land_at_the_very_end_of_the_registry() -> None:
    """⚠ 不是审美：这一路的规格逐轮可变，排在前面的话一路抖动会让后面所有内建
    工具的声明整体位移，而工具声明属于前缀缓存唯一能命中的那一段（ADR-0025）。"""
    catalog = _catalog(lambda _request: _reply([_tool("forecast")]))
    await catalog.refresh()
    registry = build_registry(ProviderDeps(mcp=catalog))
    assert registry.specs[-1].name == "mcp.weather.forecast"
    assert registry.specs_of("mcp") == (registry.specs[-1],)


async def test_an_mcp_tool_that_shadows_a_builtin_name_is_caught() -> None:
    """⚠ 装配期就抛：重名时后注册的那一路被遮掉，而遮掉的是哪一个
    从外面完全看不出来。"""
    catalog = _catalog(lambda _request: _reply([_tool("forecast")]))
    await catalog.refresh()
    clash = McpTools(catalog=catalog)
    with pytest.raises(DuplicateTool):
        registry_of((clash, clash))


async def test_no_mcp_configured_leaves_the_registry_exactly_as_it_was() -> (
    None
):
    """没配任何一路时这一路根本不进注册表——空 provider 也是噪声。"""
    catalog = _catalog(lambda _request: _reply([]), servers=())
    assert (
        build_registry(ProviderDeps(mcp=catalog)).specs
        == build_registry().specs
    )


async def test_the_selector_appends_the_round_only_specs() -> None:
    """MCP 不归任何技能，走 `extra` 直接挂在末尾——与 `user.ask` 同一个道理。"""
    catalog = _catalog(lambda _request: _reply([_tool("forecast")]))
    await catalog.refresh()
    extra = McpTools(catalog=catalog).specs()
    # ⚠ 关键字传：合并 P9 的权限收窄之后，第三个位置参数是 `codes` 而不是
    # `extra`。按位置传会把一串工具规格喂给 `PermissionGate`
    picked = specs_for("dashboard-editor", [], extra=extra)
    assert picked[-1].name == "mcp.weather.forecast"
    assert specs_for("dashboard-editor", [])[-1].name != "mcp.weather.forecast"
