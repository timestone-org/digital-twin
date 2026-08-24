"""本功能模块的依赖：写上下文。

⚠ 与服务级的 `ai_assistant.deps` 分开：那一层是全服务通用的（取容器、取会话、
认人），这一层是「会话这条业务面」自己的。混在一处的话，将来第二个功能模块
进来时会从服务级依赖里拽出一堆只属于会话的东西。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends
from pydantic import BaseModel

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.container import Container
from ai_assistant.deps import (
    get_container,
    get_idempotency_key,
    require,
)
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
    caller: Annotated[CallerContext, Depends(require(ASSISTANT_USE))],
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
