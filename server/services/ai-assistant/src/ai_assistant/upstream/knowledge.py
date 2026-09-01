"""打知识库读侧的瘦客户端。

⚠ 它**代表用户**说话：每次调用带上边缘注入的那组签名身份头，知识库按用户
自己的权限码判定。助手因此不是绕过权限的通道——它检索不到用户本来检索不到的库。

⚠ 身份头在发出去之前过一次 `DelegatedIdentity`：一个回合能跑几分钟，而边缘签
的那组头只有几十秒，不续的话回合后半段每一次调用都是 401（与 platform 同源）。

⚠ 这一层**不重试**，也**不把失败读成空**：把「知识库没答上来」读成「这个库里
没有」，助手会当着用户的面下一个完全相反的结论。

⚠ 只接**读**：建库、传文档、跑同步都在知识库自己的界面上做。助手能读的东西
越少，它被当成越权通道的可能就越小。
"""

from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

from ai_assistant.upstream.identity import DelegatedIdentity
from lib.errors import DependencyUnavailable
from lib.logging import current_traceparent, get_logger

_logger = get_logger("assistant.upstream.knowledge")

_BASES = "/api/v1/knowledge/knowledge-bases"


class KnowledgeUnavailable(DependencyUnavailable):
    """知识库没答上来。"""

    code = 52211


class _Envelope(BaseModel):
    """统一信封，本地只取 data。"""

    data: object = None


class KnowledgeClient:
    """构造不连网；连接池一个进程一份。"""

    def __init__(
        self,
        *,
        base_url: str,
        timeout_s: float,
        identity: DelegatedIdentity | None = None,
    ) -> None:
        """按地址与超时初始化。

        Args: base_url, timeout_s, identity（到期前换新的那一件）。
        """
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s
        self._identity = identity
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

    async def list_bases(self, headers: dict[str, str]) -> object:
        """列出这个人看得见的知识库。

        Args: headers。
        """
        return await self._call(
            "GET", _BASES, headers, params={"page": 1, "size": 50}
        )

    async def search(
        self, headers: dict[str, str], base_id: str, body: dict[str, Any]
    ) -> object:
        """在一个库里检索。

        Args: headers, base_id, body。
        """
        return await self._call(
            "POST", f"{_BASES}/{base_id}:search", headers, json=body
        )

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout_s,
                transport=self._transport,
            )
        return self._http

    async def _fresh(self, headers: dict[str, str]) -> dict[str, str]:
        if self._identity is None:
            return headers
        return await self._identity.fresh(headers)

    async def _call(
        self,
        method: str,
        path: str,
        headers: dict[str, str],
        **options: Any,
    ) -> object:
        """发一次并从信封里取 data。

        Args: method, path, headers, options。
        """
        try:
            fresh = await self._fresh(headers)
            response = await self._client().request(
                method, path, headers=_with_trace(fresh), **options
            )
            response.raise_for_status()
            if not response.content:
                return None
            return _Envelope.model_validate(response.json()).data
        except (httpx.HTTPError, ValidationError, ValueError) as error:
            _logger.warning(
                "knowledge_call_failed",
                "打知识库失败",
                path=path,
                error_type=type(error).__name__,
            )
            raise KnowledgeUnavailable("知识库暂时不可用") from error


def _with_trace(headers: dict[str, str]) -> dict[str, str]:
    """把当前链路的 traceparent 带上。

    ⚠ 不带的话链路在这一跳断开，而两边的日志单看都完整。

    Args: headers。
    """
    return {**headers, "traceparent": current_traceparent()}
