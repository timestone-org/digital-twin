"""闸 2 的放行与拒绝，以及身份头本身的伪造防线。

⚠ 这一层是绕过边缘直连端口时**唯一**还生效的闸。它挂错了，边缘配置正确
也救不回来——反过来也一样，所以两边的权限码由契约测试单独钉死。
"""

from collections.abc import Callable

import httpx
import pytest

from opcua_server.apps.instance.deps import (
    PERM_MANAGE,
    PERM_OPERATE,
    PERM_VIEW,
)
from opcua_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

INSTANCES = f"{API_PREFIX}/instances"
UNAUTHORIZED = 401
FORBIDDEN = 403
OK = 200
CREATED = 201


def _payload(name: str) -> dict[str, object]:
    return {
        "name": name,
        "namespace_uri": f"urn:test:{name}",
        "security_policies": ["NoSecurity"],
    }


@pytest.mark.usefixtures("clean_tables")
async def test_missing_identity_headers_are_rejected(
    client: httpx.AsyncClient,
) -> None:
    """没有身份头一律 401——直连端口不等于免鉴权。

    Args: client。
    """
    response = await client.get(INSTANCES)
    assert response.status_code == UNAUTHORIZED
    assert response.json()["data"] is None


@pytest.mark.usefixtures("clean_tables")
async def test_forged_signature_is_rejected(
    client: httpx.AsyncClient, sign_headers: Callable[..., dict[str, str]]
) -> None:
    """签名被改一个字符就拒。

    ⚠ 这条守的是「头可以伪造、签名不能」这个前提。它一旦失效，任何人
    自己发一组 X-Auth-* 头就能拿到全部权限。

    Args: client, sign_headers。
    """
    headers = sign_headers(PERM_VIEW, PERM_OPERATE, PERM_MANAGE)
    signature = headers["X-Auth-Sig"]
    # ⚠ 必须保证改出来的字符与原字符不同：签名是 hexdigest，直接写死首位为
    # "0" 时，本来就以 "0" 开头的那 1/16 会「伪造」成原值，用例随机变绿。
    headers["X-Auth-Sig"] = (
        "1" if signature.startswith("0") else "0"
    ) + signature[1:]
    assert headers["X-Auth-Sig"] != signature
    response = await client.get(INSTANCES, headers=headers)
    assert response.status_code == UNAUTHORIZED


@pytest.mark.usefixtures("clean_tables")
async def test_tampered_permissions_are_rejected(
    client: httpx.AsyncClient, sign_headers: Callable[..., dict[str, str]]
) -> None:
    """把权限头换成更宽的一份，签名就对不上了。

    Args: client, sign_headers。
    """
    weak = sign_headers(PERM_VIEW)
    strong = sign_headers(PERM_VIEW, PERM_MANAGE)
    weak["X-Auth-Permissions"] = strong["X-Auth-Permissions"]
    response = await client.post(
        INSTANCES, json=_payload("forged"), headers=weak
    )
    assert response.status_code == UNAUTHORIZED


@pytest.mark.usefixtures("clean_tables")
async def test_truncated_permission_header_is_rejected(
    client: httpx.AsyncClient, sign_headers: Callable[..., dict[str, str]]
) -> None:
    """权限头被截断时拒绝，而不是当成空权限继续。

    ⚠ 截断意味着我们不知道调用者有哪些码。按「空权限」处理看似保守，
    但它会把一个本该 401 的状况变成 403，掩盖掉边缘侧的真问题。

    Args: client, sign_headers。
    """
    headers = sign_headers(PERM_VIEW)
    headers["X-Auth-Permissions-Truncated"] = "1"
    response = await client.get(INSTANCES, headers=headers)
    assert response.status_code == UNAUTHORIZED


@pytest.mark.usefixtures("clean_tables")
async def test_view_cannot_create_instance(
    client: httpx.AsyncClient, sign_headers: Callable[..., dict[str, str]]
) -> None:
    """只读权限建不了实例。

    Args: client, sign_headers。
    """
    response = await client.post(
        INSTANCES, json=_payload("viewer"), headers=sign_headers(PERM_VIEW)
    )
    assert response.status_code == FORBIDDEN


@pytest.mark.usefixtures("clean_tables")
async def test_operate_cannot_create_instance(
    client: httpx.AsyncClient, sign_headers: Callable[..., dict[str, str]]
) -> None:
    """起停权限不等于增删权限——它们是两档。

    Args: client, sign_headers。
    """
    response = await client.post(
        INSTANCES, json=_payload("operator"), headers=sign_headers(PERM_OPERATE)
    )
    assert response.status_code == FORBIDDEN


@pytest.mark.usefixtures("clean_tables")
async def test_manage_can_create_instance(
    client: httpx.AsyncClient,
    sign_headers: Callable[..., dict[str, str]],
) -> None:
    """管理权限可以建实例。

    Args: client, sign_headers。
    """
    response = await client.post(
        INSTANCES, json=_payload("manager"), headers=sign_headers(PERM_MANAGE)
    )
    assert response.status_code == CREATED
    assert response.json()["data"]["name"] == "manager"


@pytest.mark.usefixtures("clean_tables")
async def test_view_can_list_instances(
    client: httpx.AsyncClient, sign_headers: Callable[..., dict[str, str]]
) -> None:
    """只读权限可以列表。

    Args: client, sign_headers。
    """
    response = await client.get(INSTANCES, headers=sign_headers(PERM_VIEW))
    assert response.status_code == OK
    assert isinstance(response.json()["data"]["items"], list)


@pytest.mark.usefixtures("clean_tables")
async def test_manage_alone_cannot_start_instance(
    client: httpx.AsyncClient,
    sign_headers: Callable[..., dict[str, str]],
) -> None:
    """起停要的是 `opcua:operate`，`opcua:manage` 不顶用。

    ⚠ 分档的意义就在这里：能改配置的人不自动获得对现场下指令的权限。

    Args: client, sign_headers。
    """
    created = await client.post(
        INSTANCES, json=_payload("split"), headers=sign_headers(PERM_MANAGE)
    )
    instance_id = created.json()["data"]["id"]
    response = await client.post(
        f"{INSTANCES}/{instance_id}:start", headers=sign_headers(PERM_MANAGE)
    )
    assert response.status_code == FORBIDDEN
