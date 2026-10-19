"""层级图容器与签名身份依赖。"""

from typing import Annotated

from fastapi import Header, Request

from hierarchy_server.container import Container
from lib.web.authdeps import build_auth_deps


def get_container(request: Request) -> Container:
    """读取已装配的容器。Args: request。"""
    container = request.app.state.container
    if not isinstance(container, Container):
        raise RuntimeError("层级图容器未装配")
    return container


def signing_secret(request: Request) -> str:
    return get_container(
        request
    ).settings.edge_signing_secret.get_secret_value()


def service_key(request: Request) -> str:
    return get_container(request).settings.edge_service_key.get_secret_value()


def get_idempotency_key(
    key: Annotated[
        str | None, Header(alias="Idempotency-Key", max_length=128)
    ] = None,
) -> str | None:
    return key


_auth = build_auth_deps(
    signing_secret_of=signing_secret, service_key_of=service_key
)
require = _auth.require
