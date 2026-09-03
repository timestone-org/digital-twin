"""这套部署接了哪一路重排。

⚠ 只有一路实现（走 `domain/llmcore` 的方言注册表）。留着这层注册面是为了让
「加第二路」是加一个文件加一行，而不是改调用方的函数体。

⚠ 端点来自运行期可改的目录（ADR-0039），`can_rerank` 问的是**此刻**解不解得出
端点——装配了不等于能排。

⚠ 失败分两档，只有「下游此刻不行」那一档让断路器计数：401/403/400 与
「方言配错了」都是我们自己配错了，重试与短路都没有意义——断路器一开，
真正的原因就被盖成「暂时不可用」，而那会让人去查网络。
"""

from collections.abc import Sequence
from dataclasses import dataclass

from knowledge_server.apps.knowledge.services.reranking.ports import (
    Reranker,
    RerankFailed,
)
from lib.errors import AppError
from lib.resilience import BreakerOpen, CircuitBreaker
from llmcore.rerank import (
    DynamicRerankAdapter,
    RerankScore,
    UnknownRerankDialect,
)


@dataclass(frozen=True)
class RemoteReranker:
    """把 `llmcore` 的适配器包成本层的 `Reranker`。

    ⚠ 包一层而不是直接用：本层多一格 `can_rerank`，且**把失败收敛成一种**——
    调用方对「没接」「端点拒了」「方言没装」的处置完全一样，让它去分辨这三档
    只会多出两条没人走的分支。
    """

    adapter: DynamicRerankAdapter
    breaker: CircuitBreaker

    @property
    def id(self) -> str:
        """这一路的名字。"""
        return self.adapter.id

    @property
    def model(self) -> str | None:
        """此刻用的模型名；没接时是 `None`。"""
        return self.adapter.model

    @property
    def can_rerank(self) -> bool:
        """此刻解得出端点就能排。"""
        return self.adapter.is_ready

    async def rerank(
        self, query: str, documents: Sequence[str], *, top_n: int
    ) -> list[RerankScore]:
        """排一次；排不成一律抛 `RerankFailed`。

        Args: query, documents, top_n。
        """
        try:
            self.breaker.guard()
        except BreakerOpen as error:
            raise RerankFailed("重排端点暂时不可用") from error
        try:
            made = await self.adapter.rerank(query, documents, top_n=top_n)
        except UnknownRerankDialect as error:
            raise RerankFailed(str(error)) from error
        except AppError as error:
            if error.is_retryable:
                self.breaker.record_failure(type(error).__name__)
            raise RerankFailed(error.message) from error
        self.breaker.record_success()
        return made


def build_reranker(
    adapter: DynamicRerankAdapter, breaker: CircuitBreaker
) -> Reranker:
    """按「调用时才解端点」的适配器装一路重排。

    ⚠ 总是装得出来：接没接由 `can_rerank` 在每次问到时如实回答，而不是在
    装配期钉死——目录里的分配是运行期可改的。

    Args: adapter, breaker。
    """
    return RemoteReranker(adapter=adapter, breaker=breaker)
