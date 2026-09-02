"""对话面自己的依赖：写上下文、推进一个回合要的那几样。

⚠ 与服务级的 `knowledge_server.deps` 分开：那一层是全服务通用的（取容器、
取会话、认人），这一层是「对话这条业务面」自己的。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends
from pydantic import BaseModel

from knowledge_server.apps.chat.services.advance_service import (
    AdvanceDeps,
    deps_of,
)
from knowledge_server.catalog import KNOWLEDGE_USE
from knowledge_server.container import Container
from knowledge_server.deps import get_container, get_idempotency_key, require
from lib.auth import CallerContext
from lib.idempotency import IdempotencyStore


@dataclass(frozen=True)
class WriteContext:
    """一次写请求要的三件事：谁在写、带没带幂等键、首次结果存哪。

    ⚠ 打成一包不是为了好看：路由函数的形参上限是 5，而写端点天然还要带上
    自己那一两件依赖。
    """

    idempotency: IdempotencyStore
    idempotency_key: str | None
    caller: CallerContext

    async def run_once[ResultT: BaseModel](
        self,
        *,
        endpoint: str,
        model: type[ResultT],
        action: Callable[[], Awaitable[ResultT]],
    ) -> ResultT:
        """带幂等键就只执行一次，重放直接返回首次结果。

        Args: endpoint, model, action。
        """
        return await self.idempotency.run_once(
            endpoint=endpoint,
            key=self.idempotency_key,
            caller=self.caller.user_id,
            model=model,
            action=action,
        )


def get_write_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(KNOWLEDGE_USE))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteContext:
    """建会话用的写上下文。

    Args: container, caller, idempotency_key。
    """
    return WriteContext(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
    )


def get_advance_deps(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(KNOWLEDGE_USE))],
) -> AdvanceDeps:
    """推进一个回合要的那几样。

    ⚠ 做成依赖而不是在路由里现取：用例要把会话工厂换成自己那条回滚连接，
    不然跑一遍回合就在库里留下真数据；模型也要换成假件，不然用例会打网络。

    Args: container, caller。
    """
    return deps_of(container, caller)
