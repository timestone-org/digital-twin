"""FastAPI 依赖注入件。

⚠ 本服务**没有闸 2 的权限码依赖**：对外只有 WS 端点，它的鉴权在子协议里
自己做（`services/session.py`）；内部端点走服务级密钥。这不是漏了，
是 ADR-0007 定的形态——订阅授权只比一次，且比的是主题声明的码。
"""

import hmac
from typing import Annotated

from fastapi import Depends, Header
from starlette.requests import HTTPConnection

from lib.errors import Unauthenticated
from realtime_hub.container import Container


def get_container(connection: HTTPConnection) -> Container:
    """取组合根。

    ⚠ 形参类型必须是 `HTTPConnection` 而不是 `Request`：WebSocket 端点上
    FastAPI 注入的是 `WebSocket`，声明成 `Request` 会在**握手时**以
    「get_container() missing 1 required positional argument」失败——而那条
    路径没有 HTTP 用例覆盖，只有真实握手的契约用例才照得出来。
    `HTTPConnection` 是两者的共同基类，HTTP 与 WS 都接得住。

    Args: connection。
    """
    container = connection.app.state.container
    # pragma 理由：装配失败时进程根本起不来，这条分支没有可达的测试路径
    if not isinstance(container, Container):  # pragma: no cover
        raise RuntimeError("应用未装配 container")
    return container


async def require_service_key(
    container: Annotated[Container, Depends(get_container)],
    x_service_key: Annotated[str | None, Header()] = None,
) -> None:
    """内部端点的服务级密钥。⚠ 未配置或不符一律拒绝，不是放行。

    Args: container, x_service_key。
    """
    expected = container.settings.edge_service_key.get_secret_value()
    if not expected or not x_service_key:
        raise Unauthenticated("服务级密钥缺失")
    if not hmac.compare_digest(expected, x_service_key):
        raise Unauthenticated("服务级密钥不符")
