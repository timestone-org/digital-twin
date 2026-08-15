"""点位绑定面的读写口径，打真实 Postgres。

⚠ 这一组守的核心是**绑定时就把错挡住**：类型不对、节点不存在、点位被别人
绑走了——三样都必须在保存那一刻拒绝。放行的后果不是「保存失败」，
而是每分钟往现场写一次错，且没有任何人会看见。
公共件在 `ac_model_helpers`。
"""

import uuid
from typing import Any, Protocol

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.ac_model_helpers import (
    MISSING_ID,
    PREFIX,
    SignHeaders,
    create_model,
    seed_room,
)
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.opcua import OpcuaCallFailed


class FakeNodes(Protocol):
    """conftest 里那个假下发面的形状。

    ⚠ 不从 tests.conftest 导入：`tests` 这个包名在 workspace 里被每个服务各占
    一份，跨服务解析到谁全看 sys.path 顺序。
    """

    failure: Exception | None

    def add(
        self,
        instance_id: uuid.UUID,
        node_id: uuid.UUID,
        *,
        data_type: str,
        is_writable: bool = True,
    ) -> None: ...


pytestmark = pytest.mark.requires_postgres

OK = 200
NO_CONTENT = 204
FORBIDDEN = 403
NOT_FOUND = 404
CONFLICT = 409
UNPROCESSABLE = 422
SERVICE_UNAVAILABLE = 503

INSTANCE = uuid.UUID("0192f0c0-1111-7000-8000-000000000001")


def _path(model_id: str) -> str:
    return f"{PREFIX}/ac-models/{model_id}/publication"


async def _seeded_model(
    client: httpx.AsyncClient, session: AsyncSession, sign: SignHeaders
) -> tuple[dict[str, Any], list[str]]:
    """建一个带两个服务组合的模型，返回它与两个组合的 set_key。"""
    seeded = await seed_room(session)
    model = await create_model(client, sign([AC_MANAGE]), seeded)
    keys = ["+".join(sorted(seeded.serials)), seeded.serials[0]]
    return model, sorted(keys)


def _body(**over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "opcua_instance_id": str(INSTANCE),
        "set_bindings": [],
        "is_enabled": False,
    }
    body.update(over)
    return body


async def test_reading_an_unconfigured_model_says_so(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """还没配过下发就是 404，不是一份空配置。

    ⚠ 回一份空配置会让页面显示「已绑定实例：无」，看起来像配过又被清空了。
    """
    model, _ = await _seeded_model(app_client, db_session, sign)
    response = await app_client.get(_path(model["id"]), headers=sign([AC_VIEW]))
    assert response.status_code == NOT_FOUND


async def test_saving_binds_every_point_and_reports_full_binding(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """区域点位 + 每个组合都绑上之后，才算绑齐。"""
    model, keys = await _seeded_model(app_client, db_session, sign)
    region, first, second = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    node_writer.add(INSTANCE, region, data_type="string")
    node_writer.add(INSTANCE, first, data_type="double")
    node_writer.add(INSTANCE, second, data_type="float")
    response = await app_client.put(
        _path(model["id"]),
        json=_body(
            recommendation_node_id=str(region),
            set_bindings=[
                {"set_key": keys[0], "node_id": str(first)},
                {"set_key": keys[1], "node_id": str(second)},
            ],
            is_enabled=True,
        ),
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == OK, response.text
    data = response.json()["data"]
    assert data["is_fully_bound"] is True
    assert data["unbound_set_keys"] == []
    assert [item["set_key"] for item in data["set_bindings"]] == keys
    # 标识是保存时问回来的真名，不是调用方传的
    assert data["recommendation_identifier"] == f"N-{region.hex[:8]}"


async def test_a_partly_bound_model_lists_what_is_missing(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """没绑齐时必须说出差哪几个组合，不能只说「没绑齐」。"""
    model, keys = await _seeded_model(app_client, db_session, sign)
    region, first = uuid.uuid4(), uuid.uuid4()
    node_writer.add(INSTANCE, region, data_type="string")
    node_writer.add(INSTANCE, first, data_type="double")
    response = await app_client.put(
        _path(model["id"]),
        json=_body(
            recommendation_node_id=str(region),
            set_bindings=[{"set_key": keys[0], "node_id": str(first)}],
        ),
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == OK, response.text
    data = response.json()["data"]
    assert data["is_fully_bound"] is False
    assert data["unbound_set_keys"] == [keys[1]]


async def test_a_model_without_the_region_point_is_not_fully_bound(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """组合全绑上但区域点位空着，同样不算绑齐。"""
    model, keys = await _seeded_model(app_client, db_session, sign)
    nodes = [uuid.uuid4(), uuid.uuid4()]
    for node in nodes:
        node_writer.add(INSTANCE, node, data_type="double")
    response = await app_client.put(
        _path(model["id"]),
        json=_body(
            set_bindings=[
                {"set_key": key, "node_id": str(node)}
                for key, node in zip(keys, nodes, strict=True)
            ]
        ),
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == OK, response.text
    assert response.json()["data"]["is_fully_bound"] is False


async def test_saving_rejects_a_wrong_data_type_on_the_region_point(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """区域点位只能绑字符串。

    ⚠ 放行的后果是每分钟往一个 double 点位写一串组合名，失败一次、再来一次。
    """
    model, _ = await _seeded_model(app_client, db_session, sign)
    region = uuid.uuid4()
    node_writer.add(INSTANCE, region, data_type="double")
    response = await app_client.put(
        _path(model["id"]),
        json=_body(recommendation_node_id=str(region)),
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == UNPROCESSABLE, response.text
    assert "string" in response.json()["message"]


async def test_saving_rejects_a_wrong_data_type_on_a_set_point(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """组合点位只能绑浮点：整数型放不下 12.4，也放不下 -1 的哨兵语义。"""
    model, keys = await _seeded_model(app_client, db_session, sign)
    node = uuid.uuid4()
    node_writer.add(INSTANCE, node, data_type="int32")
    response = await app_client.put(
        _path(model["id"]),
        json=_body(set_bindings=[{"set_key": keys[0], "node_id": str(node)}]),
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == UNPROCESSABLE, response.text


async def test_saving_rejects_a_node_that_is_not_writable(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """访问级别不允许写入的节点绑上去就是每分钟失败一次。"""
    model, _ = await _seeded_model(app_client, db_session, sign)
    region = uuid.uuid4()
    node_writer.add(INSTANCE, region, data_type="string", is_writable=False)
    response = await app_client.put(
        _path(model["id"]),
        json=_body(recommendation_node_id=str(region)),
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == UNPROCESSABLE, response.text


async def test_saving_rejects_a_node_that_no_longer_exists(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """节点已经不在这台实例上，当场拒绝。"""
    model, _ = await _seeded_model(app_client, db_session, sign)
    response = await app_client.put(
        _path(model["id"]),
        json=_body(recommendation_node_id=str(uuid.uuid4())),
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == UNPROCESSABLE, response.text


async def test_saving_rejects_a_set_that_is_not_a_serving_set(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """绑一个不在服务组合里的键永远不会被写，必须当场拒绝。"""
    model, _ = await _seeded_model(app_client, db_session, sign)
    node = uuid.uuid4()
    node_writer.add(INSTANCE, node, data_type="double")
    response = await app_client.put(
        _path(model["id"]),
        json=_body(set_bindings=[{"set_key": "K99+K98", "node_id": str(node)}]),
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == UNPROCESSABLE, response.text


async def test_saving_rejects_the_same_point_twice_in_one_payload(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """一份配置里同一个点位不许出现两次。"""
    model, keys = await _seeded_model(app_client, db_session, sign)
    node = uuid.uuid4()
    node_writer.add(INSTANCE, node, data_type="double")
    response = await app_client.put(
        _path(model["id"]),
        json=_body(
            set_bindings=[
                {"set_key": keys[0], "node_id": str(node)},
                {"set_key": keys[1], "node_id": str(node)},
            ]
        ),
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == UNPROCESSABLE, response.text


async def test_saving_rejects_a_point_another_model_already_writes(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """一个点位只能有一个来源。

    ⚠ 两个模型同时往一个点位写，上位机读到的值会在两者之间反复横跳，
    而两边的日志都报成功。
    """
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    first = await create_model(app_client, manager, seeded, name="模型甲")
    second = await create_model(app_client, manager, seeded, name="模型乙")
    region = uuid.uuid4()
    node_writer.add(INSTANCE, region, data_type="string")
    taken = _body(recommendation_node_id=str(region))
    assert (
        await app_client.put(_path(first["id"]), json=taken, headers=manager)
    ).status_code == OK
    clash = await app_client.put(
        _path(second["id"]), json=taken, headers=manager
    )
    assert clash.status_code == CONFLICT, clash.text


async def test_saving_fails_loudly_when_opcua_is_unreachable(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """问不到节点就不许保存。

    ⚠ 放行等于存下一份没校验过的配置，而它看起来与校验过的一模一样。
    """
    model, _ = await _seeded_model(app_client, db_session, sign)
    node_writer.failure = OpcuaCallFailed("opcua-server 不可达")
    response = await app_client.put(
        _path(model["id"]),
        json=_body(recommendation_node_id=str(uuid.uuid4())),
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == SERVICE_UNAVAILABLE, response.text


async def test_switching_instance_replaces_every_binding(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """换实例之后，旧实例上的绑定一条都不许留下。

    ⚠ 留下的话，那些 node_id 属于旧实例，每分钟往一台不相干的服务器写一次。
    """
    model, keys = await _seeded_model(app_client, db_session, sign)
    other = uuid.UUID("0192f0c0-2222-7000-8000-000000000002")
    old_node, new_node = uuid.uuid4(), uuid.uuid4()
    node_writer.add(INSTANCE, old_node, data_type="double")
    node_writer.add(other, new_node, data_type="double")
    manager = sign([AC_MANAGE])
    await app_client.put(
        _path(model["id"]),
        json=_body(
            set_bindings=[{"set_key": keys[0], "node_id": str(old_node)}]
        ),
        headers=manager,
    )
    moved = await app_client.put(
        _path(model["id"]),
        json=_body(
            opcua_instance_id=str(other),
            set_bindings=[{"set_key": keys[0], "node_id": str(new_node)}],
        ),
        headers=manager,
    )
    assert moved.status_code == OK, moved.text
    data = moved.json()["data"]
    assert data["opcua_instance_id"] == str(other)
    assert [item["node_id"] for item in data["set_bindings"]] == [str(new_node)]


async def test_a_binding_whose_set_left_the_model_is_kept_but_flagged(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """模型改了服务组合，落空的绑定留着但标出来。

    ⚠ 悄悄删掉的话，用户把组合改回去时会发现绑定没了，还以为自己没配过。
    """
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    model = await create_model(app_client, manager, seeded)
    both = "+".join(sorted(seeded.serials))
    node = uuid.uuid4()
    node_writer.add(INSTANCE, node, data_type="double")
    await app_client.put(
        _path(model["id"]),
        json=_body(set_bindings=[{"set_key": both, "node_id": str(node)}]),
        headers=manager,
    )
    narrowed = await app_client.patch(
        f"{PREFIX}/ac-models/{model['id']}",
        json={"serving_sets": [[seeded.serials[0]]]},
        headers=manager,
    )
    assert narrowed.status_code == OK, narrowed.text
    view = await app_client.get(_path(model["id"]), headers=sign([AC_VIEW]))
    data = view.json()["data"]
    assert [item["is_serving"] for item in data["set_bindings"]] == [False]
    assert data["unbound_set_keys"] == [seeded.serials[0]]
    assert data["is_fully_bound"] is False


async def test_delete_is_idempotent(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """解绑两次都算成功——DELETE 必须幂等。"""
    model, _ = await _seeded_model(app_client, db_session, sign)
    region = uuid.uuid4()
    node_writer.add(INSTANCE, region, data_type="string")
    manager = sign([AC_MANAGE])
    await app_client.put(
        _path(model["id"]),
        json=_body(recommendation_node_id=str(region)),
        headers=manager,
    )
    first = await app_client.delete(_path(model["id"]), headers=manager)
    second = await app_client.delete(_path(model["id"]), headers=manager)
    assert first.status_code == NO_CONTENT
    assert second.status_code == NO_CONTENT


async def test_deleting_the_model_takes_the_publication_with_it(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
) -> None:
    """模型删掉，发布配置与组合绑定跟着走——否则点位被永久占着。"""
    model, keys = await _seeded_model(app_client, db_session, sign)
    node = uuid.uuid4()
    node_writer.add(INSTANCE, node, data_type="double")
    manager = sign([AC_MANAGE])
    await app_client.put(
        _path(model["id"]),
        json=_body(set_bindings=[{"set_key": keys[0], "node_id": str(node)}]),
        headers=manager,
    )
    removed = await app_client.delete(
        f"{PREFIX}/ac-models/{model['id']}", headers=manager
    )
    assert removed.status_code == NO_CONTENT, removed.text
    # 同一个点位现在能被别的模型绑走，说明旧绑定确实没了
    seeded = await seed_room(db_session)
    other = await create_model(app_client, manager, seeded, name="接班模型")
    reused = await app_client.put(
        _path(other["id"]),
        json=_body(
            set_bindings=[
                {
                    "set_key": "+".join(sorted(seeded.serials)),
                    "node_id": str(node),
                }
            ]
        ),
        headers=manager,
    )
    assert reused.status_code == OK, reused.text


async def test_reading_requires_view_and_saving_requires_manage(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """只读权限改不了绑定：改的是上位机读到的现场数据。"""
    model, _ = await _seeded_model(app_client, db_session, sign)
    denied = await app_client.put(
        _path(model["id"]), json=_body(), headers=sign([AC_VIEW])
    )
    assert denied.status_code == FORBIDDEN


async def test_an_unknown_model_is_not_found(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    """模型不存在时报模型不存在，不是「没配过下发」。"""
    response = await app_client.get(_path(MISSING_ID), headers=sign([AC_VIEW]))
    assert response.status_code == NOT_FOUND
