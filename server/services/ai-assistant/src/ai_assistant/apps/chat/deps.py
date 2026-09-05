"""本功能模块的依赖：写上下文。

⚠ 与服务级的 `ai_assistant.deps` 分开：那一层是全服务通用的（取容器、取会话、
认人），这一层是「会话这条业务面」自己的。混在一处的话，将来第二个功能模块
进来时会从服务级依赖里拽出一堆只属于会话的东西。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from pydantic import BaseModel

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.services import model_profiles
from ai_assistant.apps.chat.services.advance_service import (
    AdvanceDeps,
    deps_of,
)
from ai_assistant.apps.chat.services.model_profiles import ModelDefaults
from ai_assistant.container import Container
from ai_assistant.deps import (
    get_container,
    get_idempotency_key,
    require,
)
from ai_assistant.upstream import caller_headers
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


async def get_advance_deps(
    request: Request,
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(ASSISTANT_USE))],
) -> AdvanceDeps:
    """推进一个回合要的那几样。

    ⚠ 做成依赖而不是在路由里现取：用例要把会话工厂换成自己那条回滚连接，
    不然跑一遍回合就在库里留下真数据；模型也要换成假件，不然用例会打网络。

    ⚠ 身份头从**入站请求**上原样取走：助手代表用户去调 platform，而那一侧按
    用户自己的权限码判定——助手因此不是绕过权限的通道。

    ⚠ 权限码只从**已认证的** `caller` 取，绝不从 `AdvanceIn` 载荷取：载荷是
    用户可控的，从那里取等于让人自己声明自己有哪些权限码。

    Args: request, container, caller。
    """
    # ⚠ 每轮刷一次外部工具目录：某一路 MCP 连不上时它的工具这一轮就不该下发
    # （ADR-0031 决策五）。刷在这里而不是装配期——装配期问一次的话，一路 server
    # 中途挂掉之后模型还会一直看得见它的工具，调一次失败一次
    await container.mcp.refresh()
    return deps_of(
        container, caller_headers(request.headers), codes=caller.permissions
    )


async def get_known_profiles(
    container: Annotated[Container, Depends(get_container)],
) -> tuple[str, ...]:
    """此刻在册的那几路档位名。换模型要落在其中一路上。

    ⚠ 只问「在不在册」，不问「此刻能不能用」：没登录的那一路照样选得中——
    界面上它是个待登录的选项，选中它再去登录是正常路径，而按「能不能用」拒
    会让用户在登录页与助手之间来回跳。

    ⚠ 先刷一次目录：读的是快照，不刷的话平台那边新配的一路这里永远认不出，
    表现是「刚配好的模型选不了」。

    Args: container。
    """
    await container.models.refresh()
    return tuple(one.id for one in container.models.profiles())


async def get_model_defaults(
    container: Annotated[Container, Depends(get_container)],
) -> ModelDefaults:
    """新会话该盖上的那一路模型、那一档推理。

    ⚠ 与能力端点报的默认是**同一份判定**（`model_profiles`）：各算各的话，
    界面显示订阅账号而回合走按量计费，运行期一点迹象都没有。

    Args: container。
    """
    return await model_profiles.defaults_of(
        container.models,
        container.logins,
        effort=container.settings.codex_reasoning_effort,
    )
