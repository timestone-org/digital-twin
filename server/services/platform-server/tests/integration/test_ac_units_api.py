"""空调台账的增删改查、序号唯一性与批量改派，打真实 Postgres。

⚠ 批量改派要么整批成功要么整批拒绝：静默跳过找不到的那几台，会让空间配置页
显示「已改派」而现场根本没动。
"""

import httpx

PREFIX = "/api/v1/platform"


async def build_room(client: httpx.AsyncClient, label: str) -> str:
    """建一个车间与一个房间，返回房间 id。

    Args: client, label。
    """
    workshop = await client.post(
        f"{PREFIX}/workshops", json={"name": f"{label}车间"}
    )
    assert workshop.status_code == 201, workshop.text
    room = await client.post(
        f"{PREFIX}/rooms",
        json={
            "workshop_id": workshop.json()["data"]["id"],
            "name": f"{label}房",
        },
    )
    assert room.status_code == 201, room.text
    return str(room.json()["data"]["id"])


async def add_unit(
    client: httpx.AsyncClient, *, room_id: str, serial: str, name: str
) -> str:
    """建一台空调并返回它的 id。

    Args: client, room_id, serial, name。
    """
    response = await client.post(
        f"{PREFIX}/ac-units",
        json={"serial": serial, "name": name, "room_id": room_id},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


async def test_creating_an_ac_unit_expands_its_whole_location(
    app_client: httpx.AsyncClient,
) -> None:
    room = await build_room(app_client, "建档")
    response = await app_client.post(
        f"{PREFIX}/ac-units",
        json={"serial": "AC-A-101", "name": "东侧机", "room_id": room},
    )
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["serial"] == "AC-A-101"
    assert data["room"]["id"] == room
    assert data["room"]["name"] == "建档房"
    assert data["workshop"]["name"] == "建档车间"
    assert response.headers["Location"].endswith(data["id"])


async def test_serial_is_unique_across_the_whole_plant(
    app_client: httpx.AsyncClient,
) -> None:
    first = await build_room(app_client, "重号甲")
    second = await build_room(app_client, "重号乙")
    await add_unit(
        app_client, room_id=first, serial="AC-DUP-1", name="甲机"
    )
    # 换个车间换个房间也不行：序号是全场唯一的设备编号
    duplicate = await app_client.post(
        f"{PREFIX}/ac-units",
        json={"serial": "AC-DUP-1", "name": "乙机", "room_id": second},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == 41606


async def test_creating_an_ac_unit_in_a_missing_room_is_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        f"{PREFIX}/ac-units",
        json={
            "serial": "AC-NOWHERE",
            "name": "无处安放",
            "room_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        },
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41602


async def test_units_can_be_filtered_by_room(
    app_client: httpx.AsyncClient,
) -> None:
    mine = await build_room(app_client, "筛甲")
    other = await build_room(app_client, "筛乙")
    await add_unit(app_client, room_id=mine, serial="AC-F-1", name="甲机")
    await add_unit(app_client, room_id=other, serial="AC-F-2", name="乙机")
    response = await app_client.get(
        f"{PREFIX}/ac-units", params={"room_id": mine}
    )
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert [item["serial"] for item in items] == ["AC-F-1"]


async def test_units_can_be_filtered_by_workshop(
    app_client: httpx.AsyncClient,
) -> None:
    room = await build_room(app_client, "整车间筛")
    await add_unit(app_client, room_id=room, serial="AC-W-1", name="机一")
    detail = await app_client.get(f"{PREFIX}/ac-units", params={"q": "AC-W-1"})
    workshop_id = detail.json()["data"]["items"][0]["workshop"]["id"]
    response = await app_client.get(
        f"{PREFIX}/ac-units", params={"workshop_id": workshop_id}
    )
    items = response.json()["data"]["items"]
    assert [item["serial"] for item in items] == ["AC-W-1"]


async def test_search_matches_both_serial_and_name(
    app_client: httpx.AsyncClient,
) -> None:
    room = await build_room(app_client, "搜索")
    await add_unit(app_client, room_id=room, serial="AC-S-9", name="窗边机")
    by_serial = await app_client.get(
        f"{PREFIX}/ac-units", params={"q": "ac-s-9"}
    )
    by_name = await app_client.get(f"{PREFIX}/ac-units", params={"q": "窗边"})
    assert len(by_serial.json()["data"]["items"]) == 1
    assert len(by_name.json()["data"]["items"]) == 1


async def test_relocating_moves_only_the_units_that_changed_room(
    app_client: httpx.AsyncClient,
) -> None:
    source = await build_room(app_client, "改派前")
    target = await build_room(app_client, "改派后")
    moving = await add_unit(
        app_client, room_id=source, serial="AC-R-1", name="要搬的"
    )
    staying = await add_unit(
        app_client, room_id=target, serial="AC-R-2", name="本来就在"
    )
    response = await app_client.post(
        f"{PREFIX}/ac-units:relocate",
        json={"ac_unit_ids": [moving, staying], "room_id": target},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["moved_count"] == 1
    assert data["room"]["id"] == target
    landed = await app_client.get(f"{PREFIX}/ac-units/{moving}")
    assert landed.json()["data"]["room"]["id"] == target


async def test_relocating_rejects_the_whole_batch_when_one_id_is_unknown(
    app_client: httpx.AsyncClient,
) -> None:
    source = await build_room(app_client, "整批甲")
    target = await build_room(app_client, "整批乙")
    known = await add_unit(
        app_client, room_id=source, serial="AC-B-1", name="存在的"
    )
    response = await app_client.post(
        f"{PREFIX}/ac-units:relocate",
        json={
            "ac_unit_ids": [known, "3fa85f64-5717-4562-b3fc-2c963f66afa6"],
            "room_id": target,
        },
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41603
    untouched = await app_client.get(f"{PREFIX}/ac-units/{known}")
    assert untouched.json()["data"]["room"]["id"] == source


async def test_relocating_into_a_missing_room_is_404(
    app_client: httpx.AsyncClient,
) -> None:
    room = await build_room(app_client, "无处改派")
    unit = await add_unit(
        app_client, room_id=room, serial="AC-N-1", name="机"
    )
    response = await app_client.post(
        f"{PREFIX}/ac-units:relocate",
        json={
            "ac_unit_ids": [unit],
            "room_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        },
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41602


async def test_a_room_holding_units_cannot_be_deleted(
    app_client: httpx.AsyncClient,
) -> None:
    room = await build_room(app_client, "占用")
    await add_unit(app_client, room_id=room, serial="AC-H-1", name="占位机")
    blocked = await app_client.delete(f"{PREFIX}/rooms/{room}")
    assert blocked.status_code == 409
    assert blocked.json()["code"] == 41608


async def test_updating_an_ac_unit_can_change_its_room(
    app_client: httpx.AsyncClient,
) -> None:
    source = await build_room(app_client, "单台改派前")
    target = await build_room(app_client, "单台改派后")
    unit = await add_unit(
        app_client, room_id=source, serial="AC-U-1", name="单台机"
    )
    response = await app_client.patch(
        f"{PREFIX}/ac-units/{unit}",
        json={"name": "改名后的机", "room_id": target},
    )
    assert response.status_code == 200
    assert response.json()["data"]["name"] == "改名后的机"
    assert response.json()["data"]["room"]["id"] == target


async def test_deleting_an_ac_unit_removes_it(
    app_client: httpx.AsyncClient,
) -> None:
    room = await build_room(app_client, "删除")
    unit = await add_unit(
        app_client, room_id=room, serial="AC-D-1", name="待删机"
    )
    removed = await app_client.delete(f"{PREFIX}/ac-units/{unit}")
    assert removed.status_code == 204
    gone = await app_client.get(f"{PREFIX}/ac-units/{unit}")
    assert gone.status_code == 404


async def test_units_are_listed_in_serial_order_by_default(
    app_client: httpx.AsyncClient,
) -> None:
    room = await build_room(app_client, "排序")
    await add_unit(app_client, room_id=room, serial="AC-Z-2", name="后一台")
    await add_unit(app_client, room_id=room, serial="AC-Z-1", name="前一台")
    response = await app_client.get(
        f"{PREFIX}/ac-units", params={"room_id": room}
    )
    serials = [item["serial"] for item in response.json()["data"]["items"]]
    assert serials == ["AC-Z-1", "AC-Z-2"]
