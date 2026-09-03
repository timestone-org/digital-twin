"""重排那一路的动态版：端点与方言由一个解析口子随时给，目录运行期可改。

⚠ `is_ready` 问的是**此刻解不解得出端点**，不是装配期钉死的一格：目录里的
分配随时会变，钉死的话表现是「界面上配好了、要重启才生效」。

⚠ 解不出端点时 `rerank` 抛 `RerankUnavailable`：调用方据此如实说「这次没重排」，
而不是把一批没排过序的候选当成排过的交出去。

⚠ HTTP 客户端**一个适配器一份、跟着适配器活**：连接池按主机分，换端点不必换
客户端。每次调用现造一个的话，连接不会自己回收，跑久了端口耗尽，
而现象与重排这件事毫无关系。
"""

from collections.abc import Awaitable, Callable, Sequence

import httpx

from llmcore.endpoints import RerankEndpoint
from llmcore.rerank.client import RERANK_SOURCE, HttpReranker
from llmcore.rerank.ports import RerankScore, RerankUnavailable
from llmcore.rerank.registry import dialect_of

EndpointOf = Callable[[], RerankEndpoint | None]
Refresh = Callable[[], Awaitable[object]]


class DynamicRerankAdapter:
    """按解析口子打重排端点的那一路。"""

    def __init__(
        self,
        *,
        resolve: EndpointOf,
        refresh: Refresh | None = None,
        id: str = RERANK_SOURCE,  # 理由：与协议里的属性同名
    ) -> None:
        """Args: resolve（此刻该打哪；给 `None` 即没接）, refresh（调用前先让
        目录刷新一次；没有就跳过）, id（能力面上的名字）。
        """
        self._resolve = resolve
        self._refresh = refresh
        self._id = id
        self._client: httpx.AsyncClient | None = None

    @property
    def id(self) -> str:
        """这一路重排来源的名字。"""
        return self._id

    @property
    def is_ready(self) -> bool:
        """此刻解得出端点吗。"""
        return self._resolve() is not None

    @property
    def model(self) -> str | None:
        """此刻用的模型名；没接时是 `None`。"""
        endpoint = self._resolve()
        return None if endpoint is None else endpoint.model

    @property
    def dialect(self) -> str:
        """此刻走哪一套线形；没接时是空串。能力面要说得出它。"""
        endpoint = self._resolve()
        return "" if endpoint is None else endpoint.dialect

    async def rerank(
        self, query: str, documents: Sequence[str], *, top_n: int
    ) -> list[RerankScore]:
        """把一批文档按相关度重排。

        Args: query, documents, top_n。
        """
        if self._refresh is not None:
            await self._refresh()
        endpoint = self._resolve()
        if endpoint is None:
            raise RerankUnavailable("这套部署没有接重排档")
        return await self._reranker_for(endpoint).rerank(
            query, documents, top_n=top_n
        )

    def _reranker_for(self, endpoint: RerankEndpoint) -> HttpReranker:
        """按此刻的端点与方言装一次调用面。

        ⚠ 方言认不出时**当场抛**，不退回默认那一路：退回默认打出去的是另一套
        线形，回来多半是一条 404，而那条 404 指不回「方言配错了」。

        Args: endpoint。
        """
        if self._client is None:
            # ⚠ 客户端上也要有预算：每次调用另给的那一份只盖得住走到这里的
            # 调用，而没有默认预算的客户端在别处被用到时会无限期地等
            self._client = httpx.AsyncClient(timeout=endpoint.timeout_s)
        return HttpReranker(
            client=self._client,
            endpoint=endpoint,
            dialect=dialect_of(endpoint.dialect),
            id=self._id,
        )
