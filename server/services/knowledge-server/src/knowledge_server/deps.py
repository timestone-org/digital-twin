"""FastAPI 依赖：取容器、取会话、认人。

⚠ 本服务不自己校验令牌：它读的是边缘调过认证之后注入的**签名**身份头，
与其余业务服务同一口径（lib/web/authdeps.py）。
"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import HTTPConnection

from knowledge_server.apps.knowledge.services.identity import caller_headers
from knowledge_server.apps.knowledge.services.sources import (
    KnowledgeSource,
    SourceDeps,
    build_sources,
)
from knowledge_server.container import Container
from lib.web.authdeps import build_auth_deps


def get_container(connection: HTTPConnection) -> Container:
    """取组合根。

    ⚠ 形参类型是 `HTTPConnection` 而不是 `Request`：WebSocket 端点上 FastAPI
    注入的是 `WebSocket`，声明成 `Request` 会在**握手时**以「missing 1 required
    positional argument」失败——而那条路径只有真实握手的用例才照得出来。
    `HTTPConnection` 是两者的共同基类，HTTP 与 WS 都接得住。

    Args: connection。
    """
    container = connection.app.state.container
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


def request_sources(request: Request) -> tuple[KnowledgeSource, ...]:
    """按这一次请求造一份来源集，把调用者的签名身份头带上。

    ⚠ **按请求造**：做成进程级单例会让两个用户互相借用对方的身份，而那
    从外面完全看不出来——两次同步都成功，只是其中一次读到了它不该读的东西。

    Args: request。
    """
    container = get_container(request)
    return build_sources(
        SourceDeps(
            store=container.objectstore,
            platform=container.platform,
            headers=caller_headers(dict(request.headers)),
        )
    )
