"""实例面的语义：幂等键、待重启、端口池、以及「在跑」以什么为准。"""

from collections.abc import Callable

import httpx
import pytest

from opcua_server.apps.instance.deps import (
    PERM_MANAGE,
    PERM_OPERATE,
    PERM_VIEW,
)
from opcua_server.settings import API_PREFIX, Settings

pytestmark = pytest.mark.requires_postgres

INSTANCES = f"{API_PREFIX}/instances"
OK = 200
CREATED = 201
NO_CONTENT = 204
NOT_FOUND = 404
CONFLICT = 409

Headers = Callable[..., dict[str, str]]


def _payload(name: str, **overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "name": name,
        "namespace_uri": f"urn:test:{name}",
        "security_policies": ["NoSecurity"],
    }
    body.update(overrides)
    return body


async def _create(
    client: httpx.AsyncClient, headers: Headers, name: str, **overrides: object
) -> dict[str, object]:
    response = await client.post(
        INSTANCES,
        json=_payload(name, **overrides),
        headers=headers(PERM_MANAGE),
    )
    assert response.status_code == CREATED
    return response.json()["data"]


@pytest.mark.usefixtures("clean_tables")
async def test_created_instance_is_not_running(
    client: httpx.AsyncClient, sign_headers: Headers, settings: Settings
) -> None:
    """新建的实例不会自己跑起来，且端口来自池内。

    ⚠ 断言对着配置里的池，不写死 4840-4859：测试用的池是运行时探到的
    空闲窗口（见 conftest 的 `_free_window`），写死会让这条用例在
    默认端口被占时红，而那与真缺陷长得一模一样。

    Args: client, sign_headers, settings。
    """
    data = await _create(client, sign_headers, "fresh")
    assert data["is_running"] is False
    assert data["desired_state"] == "stopped"
    assert int(str(data["port"])) in settings.ports()


@pytest.mark.usefixtures("clean_tables")
async def test_duplicate_name_is_rejected(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """同名实例冲突，返回 409 而不是 500。

    Args: client, sign_headers。
    """
    await _create(client, sign_headers, "dup")
    response = await client.post(
        INSTANCES, json=_payload("dup"), headers=sign_headers(PERM_MANAGE)
    )
    assert response.status_code == CONFLICT


@pytest.mark.usefixtures("clean_tables")
async def test_ports_do_not_repeat(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """两台实例拿到不同端口——端口是它们之间唯一的硬隔离。

    Args: client, sign_headers。
    """
    first = await _create(client, sign_headers, "alpha")
    second = await _create(client, sign_headers, "beta")
    assert first["port"] != second["port"]


@pytest.mark.usefixtures("clean_tables")
async def test_idempotency_key_replays_the_first_result(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """同一个幂等键重放，拿到的是首次结果而不是第二台实例。

    ⚠ 没有这条保证时，一次网络抖动引发的重试会白白吃掉端口池里的一个端口。

    Args: client, sign_headers。
    """
    headers = sign_headers(PERM_MANAGE)
    headers["Idempotency-Key"] = "same-key"
    first = await client.post(INSTANCES, json=_payload("idem"), headers=headers)
    second = await client.post(
        INSTANCES, json=_payload("idem"), headers=headers
    )
    assert first.status_code == CREATED
    assert second.status_code == CREATED
    assert first.json()["data"]["id"] == second.json()["data"]["id"]

    listed = await client.get(INSTANCES, headers=sign_headers(PERM_VIEW))
    assert listed.json()["data"]["total"] == 1


@pytest.mark.usefixtures("clean_tables")
async def test_different_keys_create_different_instances(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """不同幂等键是两次独立请求。

    Args: client, sign_headers。
    """
    for index, key in enumerate(("k1", "k2")):
        headers = sign_headers(PERM_MANAGE)
        headers["Idempotency-Key"] = key
        response = await client.post(
            INSTANCES, json=_payload(f"multi{index}"), headers=headers
        )
        assert response.status_code == CREATED
    listed = await client.get(INSTANCES, headers=sign_headers(PERM_VIEW))
    assert listed.json()["data"]["total"] == 2


@pytest.mark.usefixtures("clean_tables")
async def test_description_change_does_not_need_restart(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """只改描述不该把实例标成待重启——它不参与运行。

    Args: client, sign_headers。
    """
    data = await _create(client, sign_headers, "desc")
    response = await client.put(
        f"{INSTANCES}/{data['id']}",
        json={"description": "换个说明"},
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == OK
    assert response.json()["data"]["has_pending_restart"] is False


@pytest.mark.usefixtures("clean_tables")
async def test_namespace_change_marks_pending_restart(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """改命名空间 URI 要重启才生效，接口必须说出来。

    ⚠ 反面教材是返回成功、实际没生效、也不告诉用户。

    Args: client, sign_headers。
    """
    data = await _create(client, sign_headers, "ns")
    response = await client.put(
        f"{INSTANCES}/{data['id']}",
        json={"namespace_uri": "urn:test:changed"},
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.json()["data"]["has_pending_restart"] is True


@pytest.mark.usefixtures("clean_tables")
async def test_saving_the_same_value_is_not_a_change(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """传一个和现值一样的取值不算改动，不该被标成待重启。

    Args: client, sign_headers。
    """
    data = await _create(client, sign_headers, "same")
    response = await client.put(
        f"{INSTANCES}/{data['id']}",
        json={"namespace_uri": data["namespace_uri"]},
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.json()["data"]["has_pending_restart"] is False


@pytest.mark.usefixtures("clean_tables")
async def test_port_pool_reports_usage(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """端口池的占用随实例数增长。

    Args: client, sign_headers。
    """
    before = await client.get(
        f"{INSTANCES}/port-pool", headers=sign_headers(PERM_VIEW)
    )
    await _create(client, sign_headers, "pool")
    after = await client.get(
        f"{INSTANCES}/port-pool", headers=sign_headers(PERM_VIEW)
    )
    assert after.json()["data"]["used"] == before.json()["data"]["used"] + 1
    assert after.json()["data"]["available"] < before.json()["data"]["total"]


@pytest.mark.usefixtures("clean_tables")
async def test_missing_instance_returns_404(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """不存在的实例返回 404，且信封里带真错误码。

    Args: client, sign_headers。
    """
    unknown = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
    response = await client.get(
        f"{INSTANCES}/{unknown}", headers=sign_headers(PERM_VIEW)
    )
    assert response.status_code == NOT_FOUND
    assert response.json()["code"] == 42101


@pytest.mark.usefixtures("clean_tables")
async def test_delete_returns_204_and_frees_the_port(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """删实例后端口回到池里。

    Args: client, sign_headers。
    """
    data = await _create(client, sign_headers, "gone")
    response = await client.delete(
        f"{INSTANCES}/{data['id']}", headers=sign_headers(PERM_MANAGE)
    )
    assert response.status_code == NO_CONTENT
    pool = await client.get(
        f"{INSTANCES}/port-pool", headers=sign_headers(PERM_VIEW)
    )
    assert pool.json()["data"]["used"] == 0


@pytest.mark.usefixtures("clean_tables")
async def test_start_reports_liveness_from_the_real_port(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """起完之后 `is_running` 是真的连过一次端口的结果。

    ⚠ 这条守的是不变式 5：读标志位会让「说在跑但连不上」这种最难查的故障
    一路蒙混到现场。

    Args: client, sign_headers。
    """
    data = await _create(client, sign_headers, "live")
    started = await client.post(
        f"{INSTANCES}/{data['id']}:start", headers=sign_headers(PERM_OPERATE)
    )
    assert started.status_code == OK
    assert started.json()["data"]["is_running"] is True

    stopped = await client.post(
        f"{INSTANCES}/{data['id']}:stop", headers=sign_headers(PERM_OPERATE)
    )
    assert stopped.json()["data"]["is_running"] is False


@pytest.mark.usefixtures("clean_tables")
async def test_a_named_port_is_honoured(
    client: httpx.AsyncClient, sign_headers: Headers, settings: Settings
) -> None:
    """点名池内的空闲端口，就用那个，不另挑。

    Args: client, sign_headers, settings。
    """
    wanted = settings.ports()[3]
    data = await _create(client, sign_headers, "picked", port=wanted)
    assert data["port"] == wanted


@pytest.mark.usefixtures("clean_tables")
async def test_a_port_outside_the_pool_is_rejected(
    client: httpx.AsyncClient, sign_headers: Headers, settings: Settings
) -> None:
    """⚠ 池外端口一律拒绝，不静默换一个。

    池外的端口没有容器映射，上位机连不上，而实例状态会显示「运行中」。

    Args: client, sign_headers, settings。
    """
    outside = settings.ports()[-1] + 1
    response = await client.post(
        INSTANCES,
        json=_payload("outside", port=outside),
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == CONFLICT
    assert str(outside) in response.json()["message"]


@pytest.mark.usefixtures("clean_tables")
async def test_a_taken_port_is_rejected(
    client: httpx.AsyncClient, sign_headers: Headers, settings: Settings
) -> None:
    """已被占用的端口点名不了。

    Args: client, sign_headers, settings。
    """
    wanted = settings.ports()[2]
    await _create(client, sign_headers, "first", port=wanted)
    response = await client.post(
        INSTANCES,
        json=_payload("second", port=wanted),
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == CONFLICT


@pytest.mark.usefixtures("clean_tables")
async def test_port_pool_lists_the_free_ports(
    client: httpx.AsyncClient, sign_headers: Headers, settings: Settings
) -> None:
    """池子端点要给出可选的端口，页面才做得出选择器。

    Args: client, sign_headers, settings。
    """
    taken = settings.ports()[0]
    await _create(client, sign_headers, "holder", port=taken)
    body = (
        await client.get(
            f"{INSTANCES}/port-pool", headers=sign_headers(PERM_VIEW)
        )
    ).json()["data"]
    assert taken not in body["free_ports"]
    assert set(body["free_ports"]) <= set(settings.ports())
    assert len(body["free_ports"]) == body["available"]
