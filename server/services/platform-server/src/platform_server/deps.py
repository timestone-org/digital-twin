"""全服务共用的依赖注入件：组合根、事务、闸 2、幂等键。

放在服务根而不是某个功能模块下：它们与任何一个业务无关，而住在业务模块里会
让别的模块为了拿一件基础设施去 import 一个跟自己毫无关系的功能模块。
功能模块自己的上下文留在各自的 `apps/<feature>/deps.py`。

闸 2 的算法与 FastAPI 装配都在 `lib.web.authdeps`——它零项目名词，且
`opcua-server` 用的是同一份。
"""

from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.idempotency import IdempotencyStore
from lib.objectstore import ObjectStore
from lib.web.authdeps import (
    REQUIRED_CODES_ATTR,
    REQUIRED_MODE_ATTR,
    build_auth_deps,
)
from platform_server.container import Container

__all__ = [
    "REQUIRED_CODES_ATTR",
    "REQUIRED_MODE_ATTR",
    "WriteGate",
    "get_caller",
    "get_container",
    "get_idempotency_key",
    "get_object_store",
    "get_session",
    "require",
    "require_service_key",
]


def get_container(request: Request) -> Container:
    """取组合根。

    Args: request。
    """
    container = request.app.state.container
    # pragma 理由：装配失败时进程根本起不来，这条分支没有可达的测试路径
    if not isinstance(container, Container):  # pragma: no cover
        raise RuntimeError("应用未装配 container")
    return container


async def get_session(
    container: Annotated[Container, Depends(get_container)],
) -> AsyncIterator[AsyncSession]:
    """一个请求一个事务：正常出块提交，异常回滚。

    Args: container。
    """
    async with container.database.session() as session:
        yield session


def get_object_store(
    container: Annotated[Container, Depends(get_container)],
) -> ObjectStore:
    """取对象存储客户端。进程内共用一个，构造在组合根。

    ⚠ 放在服务级而不是各功能模块各写一份：`dependency_overrides` 按**函数对象**
    换，各写一份的话用例只换得掉其中一个，而另一个会在用例里真去连对象存储。
    Args: container。
    """
    return container.object_store


def get_idempotency_key(
    idempotency_key: Annotated[str | None, Header()] = None,
) -> str | None:
    """取幂等键。

    Args: idempotency_key。
    """
    return idempotency_key


@dataclass(frozen=True)
class WriteGate:
    """一次写请求都要的两件事：谁在写、这次写幂等吗。

    ⚠ 打成一包不是为了好看：路由函数的形参上限是 5，而写端点天然还要带上
    自己那一两件依赖。功能模块的写上下文继承它并补自己的字段。
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
        """带幂等键就只执行一次。

        Args: endpoint, model, action。
        """
        return await self.idempotency.run_once(
            endpoint=endpoint,
            key=self.idempotency_key,
            caller=self.caller.user_id,
            model=model,
            action=action,
        )


def _signing_secret_of(request: Request) -> str:
    settings = get_container(request).settings
    return settings.edge_signing_secret.get_secret_value()


def _service_key_of(request: Request) -> str:
    return get_container(request).settings.edge_service_key.get_secret_value()


_auth = build_auth_deps(
    signing_secret_of=_signing_secret_of,
    service_key_of=_service_key_of,
)

get_caller = _auth.caller
require = _auth.require
require_service_key = _auth.service_key
