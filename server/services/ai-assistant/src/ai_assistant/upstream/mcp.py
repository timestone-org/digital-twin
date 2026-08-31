"""打外部 MCP server 的瘦客户端与工具目录。

⚠ **只接 HTTP 传输，不接 stdio**（ADR-0031 决策一）。stdio 要每个副本起一个子
进程，而 api 角色无状态且要水平扩；子进程的生命周期、崩溃恢复、优雅关停都得
重新回答一遍。HTTP 这条与 `upstream/platform.py` 同构，超时与断路都现成。

⚠ 这一层**不重试**。一条链路只有一层负责重试，而那一层是编排层
（runtime-resilience §4.2）。

⚠ **一个 server 一个断路器。** 共用一个的话，一个 server 挂掉会把其余几路一起
短路，而它们本来好好的——这正是模型断路器上刚踩过的那个形状。

⚠ 这一层不认 `ToolSpec`：`upstream` 不许 import `apps`。它只回自己的
`McpToolInfo`，翻成工具规格是 `services/tools/providers/mcp.py` 的事。
"""

import json
from dataclasses import dataclass, field
from typing import Any, cast

import httpx

from lib.logging import get_logger
from lib.resilience import CircuitBreaker

_logger = get_logger("assistant.upstream.mcp")

# MCP 的两个方法名
_DISCOVER = "tools/list"
_INVOKE = "tools/call"

# 只读标记在这一格。⚠ 没有这一格就当成写操作，见 `McpToolInfo.is_read_only`
_ANNOTATIONS = "annotations"
_READ_ONLY_HINT = "readOnlyHint"


class McpUnavailable(RuntimeError):
    """这一路 MCP server 此刻问不到。

    ⚠ 不继承 `DependencyUnavailable`：它不该冒成一条 5xx。某个 server 连不上时
    正确的行为是**这一轮它的工具不下发**，其余照常（ADR-0031 决策五）。
    """


@dataclass(frozen=True)
class McpServer:
    """配置里的一路 MCP server。"""

    name: str
    url: str
    # 要不要带鉴权头。⚠ 为真却没配令牌 = 启动即失败，不留到第一次调用
    is_auth_required: bool = False


@dataclass(frozen=True)
class McpToolInfo:
    """server 报出来的一个工具。"""

    server: str
    tool: str
    description: str
    input_schema: dict[str, Any]
    # server 有没有明说它只读
    has_read_only_hint: bool = False

    @property
    def is_read_only(self) -> bool:
        """这个工具算不算只读。

        ⚠ **说不清就当成写操作**：MCP 的 `readOnlyHint` 是可选的，缺了这一格
        的工具可能删东西。默认放行的代价是不可逆的，默认拦下的代价只是要在
        白名单里补一行。
        """
        return self.has_read_only_hint


class McpClient:
    """按 JSON-RPC over HTTP 打一路 MCP server。构造不连网。"""

    def __init__(self, *, timeout_s: float) -> None:
        """Args: timeout_s。"""
        self._timeout_s = timeout_s
        # 传输层留成可替换的：用例验的是调用形状与失败处置，不是 httpx 本身
        self._transport: httpx.AsyncBaseTransport | None = None
        self._http: httpx.AsyncClient | None = None

    def use_transport(self, transport: httpx.AsyncBaseTransport) -> None:
        """换掉传输层。只给测试用；必须在第一次调用之前换。

        Args: transport。
        """
        self._transport = transport

    async def close(self) -> None:
        """关连接池。装了就要关，否则退出时留下一组还开着的 socket。"""
        http, self._http = self._http, None
        if http is not None:
            await http.aclose()

    async def list_tools(
        self, server: McpServer, token: str | None
    ) -> list[McpToolInfo]:
        """问这一路报了哪些工具。

        Args: server, token（`is_auth_required` 为真时必给）。
        """
        body = await self._rpc(server, token, _DISCOVER, {})
        listed = body.get("tools")
        rows = cast("list[object]", listed) if isinstance(listed, list) else []
        return [
            info
            for info in (_tool_of(server.name, row) for row in rows)
            if info is not None
        ]

    async def call_tool(
        self,
        server: McpServer,
        token: str | None,
        tool: str,
        arguments: dict[str, Any],
    ) -> Any:
        """跑一个。

        Args: server, token, tool（server 自己那一侧的名字）, arguments。
        """
        return await self._rpc(
            server, token, _INVOKE, {"name": tool, "arguments": arguments}
        )

    async def _rpc(
        self,
        server: McpServer,
        token: str | None,
        method: str,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        """一次 JSON-RPC 往返。

        Args: server, token, method, params。
        """
        client = self._client()
        headers = {"content-type": "application/json"}
        # ⚠ 令牌走独立的头，绝不拼进 URL：URL 会进日志、进链路追踪、进错误消息
        if token:
            headers["authorization"] = f"Bearer {token}"
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        }
        try:
            reply = await client.post(server.url, json=payload, headers=headers)
            reply.raise_for_status()
            body = reply.json()
        except (httpx.HTTPError, json.JSONDecodeError) as error:
            raise McpUnavailable(
                f"{server.name} 没答上来：{type(error).__name__}"
            ) from error
        if not isinstance(body, dict):
            raise McpUnavailable(f"{server.name} 回了一段读不懂的东西")
        envelope = cast("dict[str, Any]", body)
        if "error" in envelope:
            raise McpUnavailable(f"{server.name} 回了一条错误")
        result = envelope.get("result")
        if not isinstance(result, dict):
            return {}
        return cast("dict[str, Any]", result)

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=self._timeout_s, transport=self._transport
            )
        return self._http


@dataclass
class McpCatalog:
    """这套部署接了哪几路 MCP，以及它们此刻报出来的工具。

    ⚠ 一个进程一份、长活：连接池与断路器都要跨请求活着，每次现造一个的话
    断路器永远停在「closed」，等于没有断路器。
    """

    client: McpClient
    servers: tuple[McpServer, ...]
    tokens: dict[str, str]
    breakers: dict[str, CircuitBreaker]
    # 上一次问到的工具，按 server 名分组
    _found: dict[str, tuple[McpToolInfo, ...]] = field(
        default_factory=dict[str, tuple[McpToolInfo, ...]]
    )

    async def refresh(self) -> None:
        """逐路重问一遍。

        ⚠ **一路问不到只丢它自己**：其余照常，整个助手照常起
        （ADR-0031 决策五）。断路器打开期间连问都不问，直接当它这一轮缺席。
        """
        for server in self.servers:
            self._found[server.name] = await self._ask(server)

    def tools(self) -> tuple[McpToolInfo, ...]:
        """此刻问得到的全部工具，按配置里的 server 次序。"""
        return tuple(
            info
            for server in self.servers
            for info in self._found.get(server.name, ())
        )

    def find(self, server: str, tool: str) -> McpToolInfo | None:
        """按 server 与工具名取一条；没有给 `None`。

        Args: server, tool。
        """
        return next(
            (one for one in self._found.get(server, ()) if one.tool == tool),
            None,
        )

    async def call(
        self, server: str, tool: str, arguments: dict[str, Any]
    ) -> Any:
        """跑一路上的一个工具。

        Args: server, tool, arguments。
        """
        found = next((one for one in self.servers if one.name == server), None)
        if found is None:
            raise McpUnavailable(f"没有 {server} 这一路 MCP")
        breaker = self.breakers[server]
        breaker.guard()
        try:
            reply = await self.client.call_tool(
                found, self.tokens.get(server), tool, arguments
            )
        except McpUnavailable:
            breaker.record_failure("call")
            raise
        breaker.record_success()
        return reply

    async def _ask(self, server: McpServer) -> tuple[McpToolInfo, ...]:
        """问一路；问不到就当它这一轮缺席，并留下上一次的空表。

        Args: server。
        """
        breaker = self.breakers[server.name]
        if not breaker.allow():
            return ()
        try:
            listed = await self.client.list_tools(
                server, self.tokens.get(server.name)
            )
        except McpUnavailable:
            breaker.record_failure("list")
            # ⚠ 只记 server 名，**不记回包正文与工具描述**：那是外部可控的
            # 长文本，记全文既胀日志，又把可能的注入内容搬进另一条链路
            _logger.warning("mcp_list_failed", extra={"server": server.name})
            return ()
        breaker.record_success()
        return tuple(listed)


def _tool_of(server: str, row: object) -> McpToolInfo | None:
    """把 server 报的一行翻成一个工具；形状不对给 `None`。

    Args: server, row。
    """
    if not isinstance(row, dict):
        return None
    raw = cast("dict[str, Any]", row)
    name = raw.get("name")
    if not isinstance(name, str) or not name:
        return None
    schema = raw.get("inputSchema")
    annotations = raw.get(_ANNOTATIONS)
    # ⚠ 先收窄再取值：`isinstance` 从 `Any` narrow 出来的是
    # `dict[Unknown, Unknown]`，直接 `.get` 会把未知类型一路带下去
    marks = (
        cast("dict[str, Any]", annotations)
        if isinstance(annotations, dict)
        else {}
    )
    hint = marks.get(_READ_ONLY_HINT) is True
    return McpToolInfo(
        server=server,
        tool=name,
        description=str(raw.get("description") or ""),
        input_schema=(
            cast("dict[str, Any]", schema) if isinstance(schema, dict) else {}
        ),
        has_read_only_hint=hint,
    )
