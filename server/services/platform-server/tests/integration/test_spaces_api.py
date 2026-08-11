"""车间与房间的增删改查、唯一性与删除守卫，打真实 Postgres。

⚠ 删除守卫是这条链路最要紧的一条：车间下有房间、房间里有空调时必须 409。
级联删会让一次误点把一台一台录进去的台账连根带走。
"""

import httpx

PREFIX = "/api/v1/platform"


async def create_workshop(client: httpx.AsyncClient, name: str) -> str:
    """建一个车间并返回它的 id。

    Args: client, name。
    """
    response = await client.post(f"{PREFIX}/workshops", json={"name": name})
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


async def create_room(
    client: httpx.AsyncClient, *, workshop_id: str, name: str
) -> str:
    """在某个车间里建一个房间并返回它的 id。

    Args: client, workshop_id, name。
    """
    response = await client.post(
        f"{PREFIX}/rooms", json={"workshop_id": workshop_id, "name": name}
    )
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


async def test_creating_a_workshop_returns_201_with_a_location(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        f"{PREFIX}/workshops", json={"name": "东车间"}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["code"] == 0
    assert body["data"]["name"] == "东车间"
    assert body["data"]["room_count"] == 0
    assert body["data"]["ac_unit_count"] == 0
    assert response.headers["Location"].endswith(body["data"]["id"])


async def test_workshop_names_are_unique_across_the_plant(
    app_client: httpx.AsyncClient,
) -> None:
    await create_workshop(app_client, "南车间")
    duplicate = await app_client.post(
        f"{PREFIX}/workshops", json={"name": "南车间"}
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == 41604


async def test_room_names_are_unique_only_inside_their_workshop(
    app_client: httpx.AsyncClient,
) -> None:
    first = await create_workshop(app_client, "一号车间")
    second = await create_workshop(app_client, "二号车间")
    await create_room(app_client, workshop_id=first, name="配电房")
    # 两个车间各有一间「配电房」是常态，不该被拦
    shared = await app_client.post(
        f"{PREFIX}/rooms", json={"workshop_id": second, "name": "配电房"}
    )
    assert shared.status_code == 201
    duplicate = await app_client.post(
        f"{PREFIX}/rooms", json={"workshop_id": first, "name": "配电房"}
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == 41605


async def test_creating_a_room_in_a_missing_workshop_is_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        f"{PREFIX}/rooms",
        json={
            "workshop_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            "name": "注塑房",
        },
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41601


async def test_rooms_can_be_filtered_by_workshop(
    app_client: httpx.AsyncClient,
) -> None:
    mine = await create_workshop(app_client, "过滤车间甲")
    other = await create_workshop(app_client, "过滤车间乙")
    await create_room(app_client, workshop_id=mine, name="甲房")
    await create_room(app_client, workshop_id=other, name="乙房")
    response = await app_client.get(
        f"{PREFIX}/rooms", params={"workshop_id": mine}
    )
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert [item["name"] for item in items] == ["甲房"]
    assert items[0]["workshop"]["id"] == mine


async def test_workshops_can_be_searched_by_name(
    app_client: httpx.AsyncClient,
) -> None:
    await create_workshop(app_client, "冷冻车间")
    await create_workshop(app_client, "干燥车间")
    response = await app_client.get(f"{PREFIX}/workshops", params={"q": "冷冻"})
    names = [item["name"] for item in response.json()["data"]["items"]]
    assert names == ["冷冻车间"]


async def test_reading_a_single_room_expands_its_workshop(
    app_client: httpx.AsyncClient,
) -> None:
    workshop = await create_workshop(app_client, "详情车间")
    room = await create_room(app_client, workshop_id=workshop, name="详情房")
    response = await app_client.get(f"{PREFIX}/rooms/{room}")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["name"] == "详情房"
    assert data["workshop"]["name"] == "详情车间"
    assert data["ac_unit_count"] == 0


async def test_reading_a_missing_room_is_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        f"{PREFIX}/rooms/3fa85f64-5717-4562-b3fc-2c963f66afa6"
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41602


async def test_deleting_a_workshop_that_still_has_rooms_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    workshop = await create_workshop(app_client, "有房间的车间")
    await create_room(app_client, workshop_id=workshop, name="装配房")
    blocked = await app_client.delete(f"{PREFIX}/workshops/{workshop}")
    assert blocked.status_code == 409
    assert blocked.json()["code"] == 41607


async def test_an_emptied_workshop_can_be_deleted(
    app_client: httpx.AsyncClient,
) -> None:
    workshop = await create_workshop(app_client, "待清空车间")
    room = await create_room(app_client, workshop_id=workshop, name="临时房")
    room_gone = await app_client.delete(f"{PREFIX}/rooms/{room}")
    assert room_gone.status_code == 204
    workshop_gone = await app_client.delete(f"{PREFIX}/workshops/{workshop}")
    assert workshop_gone.status_code == 204
    lookup = await app_client.get(f"{PREFIX}/workshops/{workshop}")
    assert lookup.status_code == 404


async def test_a_room_can_be_moved_to_another_workshop(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_workshop(app_client, "搬迁前车间")
    target = await create_workshop(app_client, "搬迁后车间")
    room = await create_room(app_client, workshop_id=source, name="整体搬迁房")
    response = await app_client.patch(
        f"{PREFIX}/rooms/{room}", json={"workshop_id": target}
    )
    assert response.status_code == 200
    assert response.json()["data"]["workshop"]["id"] == target


async def test_an_explicit_null_in_a_patch_changes_nothing(
    app_client: httpx.AsyncClient,
) -> None:
    # 本模块的列全部 NOT NULL，null 不表示「清空」，与不传同义
    workshop = await create_workshop(app_client, "显式空值车间")
    response = await app_client.patch(
        f"{PREFIX}/workshops/{workshop}", json={"name": None}
    )
    assert response.status_code == 200
    assert response.json()["data"]["name"] == "显式空值车间"


async def test_workshop_counts_reflect_what_is_inside(
    app_client: httpx.AsyncClient,
) -> None:
    workshop = await create_workshop(app_client, "计数车间")
    room = await create_room(app_client, workshop_id=workshop, name="计数房")
    await app_client.post(
        f"{PREFIX}/ac-units",
        json={"serial": "COUNT-1", "name": "计数机", "room_id": room},
    )
    response = await app_client.get(f"{PREFIX}/workshops/{workshop}")
    assert response.status_code == 200
    assert response.json()["data"]["room_count"] == 1
    assert response.json()["data"]["ac_unit_count"] == 1


async def test_sorting_by_a_field_outside_the_whitelist_is_400(
    app_client: httpx.AsyncClient,
) -> None:
    # 白名单之外直接 400，不静默忽略——静默忽略会让人以为排序生效了
    response = await app_client.get(
        f"{PREFIX}/workshops", params={"sort": "name; drop table"}
    )
    assert response.status_code == 400
    assert response.json()["code"] == 40001


async def test_page_size_beyond_the_ceiling_is_400(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        f"{PREFIX}/workshops", params={"size": 1_000_000}
    )
    assert response.status_code == 400
