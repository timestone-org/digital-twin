"""上位机身份面：在线会话、实例凭据、信任证书。

⚠ 凭据与证书都归 `opcua:manage`——它们决定谁能连上这台服务器。
会话只是查看，归 `opcua:view`。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from opcua_server.apps.instance.deps import (
    PERM_MANAGE,
    PERM_VIEW,
    get_container,
    require,
)
from opcua_server.apps.instance.schemas import (
    CredentialCreatedOut,
    CredentialCreateIn,
    CredentialOut,
    SessionOut,
    TrustedCertificateCreateIn,
    TrustedCertificateOut,
)
from opcua_server.container import Container
from opcua_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/instances/{{instance_id}}", tags=["security"]
)

ContainerDep = Annotated[Container, Depends(get_container)]
ViewDep = Annotated[CallerContext, Depends(require(PERM_VIEW))]
ManageDep = Annotated[CallerContext, Depends(require(PERM_MANAGE))]


@router.get(
    "/sessions",
    response_model=ApiResponse[list[SessionOut]],
    summary="在线会话",
)
async def list_sessions(
    instance_id: uuid.UUID, container: ContainerDep, _viewer: ViewDep
) -> ApiResponse[list[SessionOut]]:
    """列出连上来的上位机。⚠ 实例没在跑时是空数组，不是错误。

    Args: instance_id, container, _viewer。
    """
    return ok(await container.security.list_sessions(instance_id))


@router.get(
    "/credentials",
    response_model=ApiResponse[list[CredentialOut]],
    summary="实例凭据列表",
)
async def list_credentials(
    instance_id: uuid.UUID, container: ContainerDep, _manager: ManageDep
) -> ApiResponse[list[CredentialOut]]:
    """列出上位机账号。散列不出现在出参里。

    Args: instance_id, container, _manager。
    """
    return ok(await container.security.list_credentials(instance_id))


@router.post(
    "/credentials",
    response_model=ApiResponse[CredentialCreatedOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建实例凭据",
)
async def create_credential(
    instance_id: uuid.UUID,
    payload: CredentialCreateIn,
    container: ContainerDep,
    _manager: ManageDep,
) -> ApiResponse[CredentialCreatedOut]:
    """建上位机账号。⚠ 明文口令**只在这次响应里出现一次**，丢了只能重建。

    Args: instance_id, payload, container, _manager。
    """
    created = await container.security.create_credential(instance_id, payload)
    return ok(created, message="凭据已创建，请立即保存口令")


@router.delete(
    "/credentials/{credential_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除实例凭据",
)
async def delete_credential(
    instance_id: uuid.UUID,
    credential_id: uuid.UUID,
    container: ContainerDep,
    _manager: ManageDep,
) -> Response:
    """删上位机账号。

    Args: instance_id, credential_id, container, _manager。
    """
    await container.security.delete_credential(instance_id, credential_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/trusted-certificates",
    response_model=ApiResponse[list[TrustedCertificateOut]],
    summary="信任证书列表",
)
async def list_certificates(
    instance_id: uuid.UUID, container: ContainerDep, _manager: ManageDep
) -> ApiResponse[list[TrustedCertificateOut]]:
    """列出被信任的客户端证书。

    Args: instance_id, container, _manager。
    """
    return ok(await container.security.list_certificates(instance_id))


@router.post(
    "/trusted-certificates",
    response_model=ApiResponse[TrustedCertificateOut],
    status_code=status.HTTP_201_CREATED,
    summary="登记信任证书",
)
async def add_certificate(
    instance_id: uuid.UUID,
    payload: TrustedCertificateCreateIn,
    container: ContainerDep,
    _manager: ManageDep,
) -> ApiResponse[TrustedCertificateOut]:
    """按指纹登记客户端证书。⚠ 带私钥的输入一律拒绝。

    Args: instance_id, payload, container, _manager。
    """
    created = await container.security.add_certificate(instance_id, payload)
    return ok(created, message="证书已登记")


@router.delete(
    "/trusted-certificates/{certificate_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="撤销信任证书",
)
async def delete_certificate(
    instance_id: uuid.UUID,
    certificate_id: uuid.UUID,
    container: ContainerDep,
    _manager: ManageDep,
) -> Response:
    """撤销一张信任证书。

    Args: instance_id, certificate_id, container, _manager。
    """
    await container.security.delete_certificate(instance_id, certificate_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
