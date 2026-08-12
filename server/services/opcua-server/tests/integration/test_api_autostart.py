"""开机自启：标了自启的实例会被拉起，且一台起不来不牵连其余。"""

import socket
from collections.abc import Callable
from typing import Any, cast

import httpx
import pytest

from opcua_server.apps.instance.deps import PERM_MANAGE, PERM_VIEW
from opcua_server.container import Container
from opcua_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

INSTANCES = f"{API_PREFIX}/instances"
CREATED = 201

Headers = Callable[..., dict[str, str]]


def _container(transport: httpx.ASGITransport) -> Container:
    """从 ASGI 应用里取回组合根。

    Args: transport。
    """
    state = cast(Any, transport.app).state
    return cast(Container, state.container)


async def _create(
    client: httpx.AsyncClient,
    headers: Headers,
    name: str,
    *,
    is_autostart: bool,
) -> str:
    response = await client.post(
        INSTANCES,
        json={
            "name": name,
            "namespace_uri": f"urn:test:{name}",
            "security_policies": ["NoSecurity"],
            "is_autostart": is_autostart,
        },
        headers=headers(PERM_MANAGE),
    )
    assert response.status_code == CREATED
    return str(response.json()["data"]["id"])


@pytest.mark.usefixtures("clean_tables")
async def test_autostart_only_starts_flagged_instances(
    client: httpx.AsyncClient,
    app: httpx.ASGITransport,
    sign_headers: Headers,
) -> None:
    """只有标了自启的会被拉起，没标的保持停止。

    Args: client, app, sign_headers。
    """
    wanted = await _create(client, sign_headers, "auto-on", is_autostart=True)
    skipped = await _create(
        client, sign_headers, "auto-off", is_autostart=False
    )

    await _container(app).instances.autostart()

    running = await client.get(
        f"{INSTANCES}/{wanted}", headers=sign_headers(PERM_VIEW)
    )
    stopped = await client.get(
        f"{INSTANCES}/{skipped}", headers=sign_headers(PERM_VIEW)
    )
    assert running.json()["data"]["is_running"] is True
    assert stopped.json()["data"]["is_running"] is False


@pytest.mark.usefixtures("clean_tables")
async def test_autostart_survives_a_port_conflict(
    client: httpx.AsyncClient,
    app: httpx.ASGITransport,
    sign_headers: Headers,
) -> None:
    """一台起不来不挡住其余的——自启逐台兜异常。

    ⚠ 不兜的话，某个实例的端口被别人占了会让**整个进程**起不来，
    而现象是「服务挂了」，跟真正的原因隔得极远。

    Args: client, app, sign_headers。
    """
    container = _container(app)
    first = await _create(client, sign_headers, "auto-a", is_autostart=True)
    second = await _create(client, sign_headers, "auto-b", is_autostart=True)

    # 先占住其中一台要用的端口，制造真实的 bind 冲突
    detail = await client.get(
        f"{INSTANCES}/{first}", headers=sign_headers(PERM_VIEW)
    )
    blocker = socket.socket()
    blocker.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    blocker.bind(("0.0.0.0", int(detail.json()["data"]["port"])))  # noqa: S104
    blocker.listen(1)
    try:
        await container.instances.autostart()
    finally:
        blocker.close()

    survivor = await client.get(
        f"{INSTANCES}/{second}", headers=sign_headers(PERM_VIEW)
    )
    assert survivor.json()["data"]["is_running"] is True
