"""FastAPI 依赖：取容器、取会话、认人。

⚠ 本服务不自己校验令牌：它读的是边缘调过认证之后注入的**签名**身份头，
与其余业务服务同一口径（lib/web/authdeps.py）。
"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.container import Container
from lib.web.authdeps import build_auth_deps


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


def get_idempotency_key(
    idempotency_key: Annotated[str | None, Header()] = None,
) -> str | None:
    """取幂等键。

    Args: idempotency_key。
    """
    return idempotency_key


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
