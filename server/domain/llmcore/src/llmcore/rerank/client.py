"""按某一套方言打一次重排端点，并把失败收敛成本层的两档。

⚠ 传输与方言分开：路径、请求体、回包读法各家不同，而**打一次 HTTP、按状态码
分档、把解不动的回包算成我们自己配错**这几件事是同一份。混在一起写的话，
加一路方言就要再抄一遍失败分档，而抄漏的那一份表现是「换了一家之后，
密钥配错也会让断路器打开」。

⚠ 这一层**不重试**：一条链路只有一层负责重试，而那一层是调用方的编排层。
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from llmcore.endpoints import RerankEndpoint
from llmcore.errors import ModelRejected, ModelUnavailable, classified_status
from llmcore.rerank.ports import (
    RerankDialect,
    RerankQuery,
    RerankScore,
    RerankShapeUnreadable,
)

# 这一路在能力面上的名字
RERANK_SOURCE = "remote-rerank"

# 从这个状态码起算失败
_FIRST_ERROR_STATUS = 400


@dataclass(frozen=True)
class HttpReranker:
    """一个端点 + 一套方言，打一次就回一批「下标 + 分数」。"""

    client: httpx.AsyncClient
    endpoint: RerankEndpoint
    dialect: RerankDialect
    id: str = RERANK_SOURCE
    # 端点定死的这一路造出来就能用；动态那一路才会在运行期变成假
    is_ready: bool = True

    @property
    def model(self) -> str | None:
        """此刻用的模型名。"""
        return self.endpoint.model

    async def rerank(
        self, query: str, documents: Sequence[str], *, top_n: int
    ) -> list[RerankScore]:
        """把一批文档按相关度重排。

        ⚠ 空批不打端点：一次必然无意义的往返，而有的端点对空 documents 直接
        回 400——那条 400 会被算成「我们发错了」，看着像密钥配错。

        Args: query, documents, top_n。
        """
        rows = tuple(documents)
        if not rows:
            return []
        ask = RerankQuery(
            model=self.endpoint.model,
            query=query,
            documents=rows,
            top_n=min(top_n, len(rows)),
        )
        body = await self._post(self.dialect.body_of(ask))
        try:
            return self.dialect.scores_of(body, len(rows))
        except RerankShapeUnreadable as error:
            raise ModelRejected(f"{error}（方言可能配错了）") from error

    async def _post(self, body: dict[str, Any]) -> object:
        """打一次，回解好的 JSON；失败按两档抛。

        Args: body。
        """
        try:
            answer = await self.client.post(
                _url_of(self.endpoint.base_url, self.dialect.path),
                json=body,
                headers=_headers_of(self.endpoint),
                timeout=self.endpoint.timeout_s,
            )
        except httpx.TimeoutException as error:
            raise ModelUnavailable("重排端点未响应") from error
        except httpx.HTTPError as error:
            raise ModelUnavailable("连不上重排端点") from error
        if answer.status_code >= _FIRST_ERROR_STATUS:
            raise classified_status(answer.status_code)
        try:
            return answer.json()
        except ValueError as error:
            raise ModelRejected("重排端点回的不是 JSON") from error


def _url_of(base_url: str, path: str) -> str:
    """端点根接上方言自己的那一段路径。

    ⚠ 自己拼而不是交给客户端的 base_url：`httpx` 的相对地址会把根上最后一段
    路径吃掉（`/api/v1` + `rerank` 解成 `/api/v1/rerank` 还是 `/rerank`
    取决于有没有那个尾斜杠），而两种结果里只有一种打得通。

    Args: base_url, path。
    """
    return f"{base_url.rstrip('/')}/{path}"


def _headers_of(endpoint: RerankEndpoint) -> dict[str, str]:
    """这一次调用的请求头。

    ⚠ 密钥只在这里落成字符串，不进日志也不进异常信息。

    Args: endpoint。
    """
    return {
        "Authorization": f"Bearer {endpoint.api_key.get_secret_value()}",
        "Content-Type": "application/json",
    }
