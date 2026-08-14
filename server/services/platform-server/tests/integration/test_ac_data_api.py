"""数据源绑定与达标范围的读写面，打真实 Postgres。

⚠ 两个 `PUT` 都是覆盖式：绑定同一数据集是覆盖不是新增，达标范围里没出现的
指标视为清除。这两条语义写错都不会报错，只会静默留下旧值。
"""

from collections.abc import Callable

import httpx

from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW

PREFIX = "/api/v1/platform"
DATASET = "raw_minute"
MISSING_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"

# conftest 的 `sign` fixture 形状。⚠ 不从 tests.conftest 导入：`tests` 这个包名
# 在 workspace 里被每个服务各占一份，跨服务解析到谁全看 sys.path 顺序。
SignHeaders = Callable[..., dict[str, str]]


async def make_unit(client: httpx.AsyncClient, label: str) -> str:
    """建一个车间、一个房间与一台空调，返回空调 id。

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
    unit = await client.post(
        f"{PREFIX}/ac-units",
        json={
            "serial": f"AC-{label}",
            "name": f"{label}机",
            "room_id": room.json()["data"]["id"],
        },
    )
    assert unit.status_code == 201, unit.text
    return str(unit.json()["data"]["id"])


async def test_dataset_catalog_carries_units_and_chart_defaults(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{PREFIX}/ac-datasets")
    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 0
    datasets = body["data"]["items"]
    assert [item["key"] for item in datasets] == [DATASET]
    metrics = datasets[0]["metrics"]
    assert len(metrics) == 19
    by_key = {item["key"]: item for item in metrics}
    assert by_key["workshop_temp_avg"]["unit"] == "℃"
    assert by_key["workshop_temp_avg"]["group"] == "temperature"
    assert by_key["fan_frequency"]["unit"] == "Hz"
    # 达标范围本期只开车间温湿度两项
    assert {key for key, item in by_key.items() if item["is_limitable"]} == {
        "workshop_temp_avg",
        "workshop_humidity_avg",
    }
    assert {
        key for key, item in by_key.items() if item["is_charted_by_default"]
    } == {
        "workshop_temp_avg",
        "workshop_humidity_avg",
        "ac_temp_setpoint",
        "ac_humidity_setpoint",
    }


async def test_binding_the_same_dataset_twice_overwrites_it(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await make_unit(app_client, "绑定")
    first = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/data-bindings/{DATASET}",
        json={"source_object": "KTStartData_K01"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["data"]["source_object"] == "KTStartData_K01"
    second = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/data-bindings/{DATASET}",
        json={"source_object": "KTStartData_K02"},
    )
    assert second.status_code == 200, second.text
    listed = await app_client.get(f"{PREFIX}/ac-units/{unit}/data-bindings")
    items = listed.json()["data"]["items"]
    assert [item["source_object"] for item in items] == ["KTStartData_K02"]


async def test_deleting_a_binding_that_was_never_set_still_succeeds(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await make_unit(app_client, "幂等删")
    response = await app_client.delete(
        f"{PREFIX}/ac-units/{unit}/data-bindings/{DATASET}"
    )
    assert response.status_code == 204
    assert response.content == b""


async def test_deleting_an_existing_binding_removes_it(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await make_unit(app_client, "解绑")
    await app_client.put(
        f"{PREFIX}/ac-units/{unit}/data-bindings/{DATASET}",
        json={"source_object": "KTStartData_K03"},
    )
    response = await app_client.delete(
        f"{PREFIX}/ac-units/{unit}/data-bindings/{DATASET}"
    )
    assert response.status_code == 204
    listed = await app_client.get(f"{PREFIX}/ac-units/{unit}/data-bindings")
    assert listed.json()["data"]["items"] == []


async def test_binding_rejects_an_object_name_that_could_reach_sql(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await make_unit(app_client, "注入")
    for hostile in ("KT;DROP TABLE x", "KT-01", "KT 01", "KT'01"):
        response = await app_client.put(
            f"{PREFIX}/ac-units/{unit}/data-bindings/{DATASET}",
            json={"source_object": hostile},
        )
        assert response.status_code == 422, hostile
        assert response.json()["code"] == 41611, hostile


async def test_binding_rejects_a_trailing_newline_in_the_object_name(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ `re.match` 会放过它——Python 的 `$` 也匹配结尾换行
    unit = await make_unit(app_client, "换行")
    response = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/data-bindings/{DATASET}",
        json={"source_object": "KTStartData_K01\n"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == 41611


async def test_binding_an_unknown_dataset_is_404(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await make_unit(app_client, "未知集")
    response = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/data-bindings/hourly_energy",
        json={"source_object": "KTStartData_K01"},
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41609


async def test_binding_an_unknown_ac_unit_is_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        f"{PREFIX}/ac-units/{MISSING_ID}/data-bindings"
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41603


async def test_metric_limits_are_replaced_not_merged(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await make_unit(app_client, "覆盖")
    first = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/metric-limits",
        json={
            "items": [
                {
                    "metric": "workshop_temp_avg",
                    "lower_limit": "20.00",
                    "upper_limit": "26.00",
                },
                {
                    "metric": "workshop_humidity_avg",
                    "lower_limit": "45.00",
                    "upper_limit": "65.00",
                },
            ]
        },
    )
    assert first.status_code == 200, first.text
    assert len(first.json()["data"]["items"]) == 2
    # 只提交温度这一项，湿度那条应当被清掉而不是留着
    second = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/metric-limits",
        json={
            "items": [
                {
                    "metric": "workshop_temp_avg",
                    "lower_limit": "21.00",
                    "upper_limit": "25.00",
                }
            ]
        },
    )
    assert second.status_code == 200, second.text
    items = second.json()["data"]["items"]
    assert [item["metric"] for item in items] == ["workshop_temp_avg"]
    assert items[0]["lower_limit"] == "21.00"


async def test_limits_serialize_as_strings_not_json_numbers(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 数字会在 JS 侧变成双精度浮点，20.15 读回来是 20.149999999999999
    unit = await make_unit(app_client, "精确值")
    await app_client.put(
        f"{PREFIX}/ac-units/{unit}/metric-limits",
        json={
            "items": [{"metric": "workshop_temp_avg", "upper_limit": "20.15"}]
        },
    )
    response = await app_client.get(f"{PREFIX}/ac-units/{unit}/metric-limits")
    item = response.json()["data"]["items"][0]
    assert item["upper_limit"] == "20.15"
    assert isinstance(item["upper_limit"], str)
    assert item["lower_limit"] is None


async def test_a_limit_with_both_bounds_empty_is_not_stored(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await make_unit(app_client, "空范围")
    response = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/metric-limits",
        json={"items": [{"metric": "workshop_temp_avg"}]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["items"] == []


async def test_lower_limit_above_upper_limit_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await make_unit(app_client, "倒置")
    response = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/metric-limits",
        json={
            "items": [
                {
                    "metric": "workshop_temp_avg",
                    "lower_limit": "30.00",
                    "upper_limit": "20.00",
                }
            ]
        },
    )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == 40001
    assert body["details"][0]["field"] == "items[0].metric"


async def test_a_metric_without_limits_support_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await make_unit(app_client, "不可配")
    response = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/metric-limits",
        json={"items": [{"metric": "fan_frequency", "upper_limit": "50.00"}]},
    )
    assert response.status_code == 422
    assert response.json()["code"] == 41614


async def test_the_same_metric_twice_in_one_request_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await make_unit(app_client, "重复指标")
    response = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/metric-limits",
        json={
            "items": [
                {"metric": "workshop_temp_avg", "upper_limit": "26.00"},
                {"metric": "workshop_temp_avg", "upper_limit": "28.00"},
            ]
        },
    )
    assert response.status_code == 400
    assert response.json()["code"] == 40001


async def test_a_read_only_caller_cannot_write_bindings_or_limits(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    unit = await make_unit(app_client, "只读")
    headers = sign([AC_VIEW])
    binding = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/data-bindings/{DATASET}",
        json={"source_object": "KTStartData_K01"},
        headers=headers,
    )
    assert binding.status_code == 403
    assert binding.json()["code"] == 40106
    limits = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/metric-limits",
        json={"items": []},
        headers=headers,
    )
    assert limits.status_code == 403


async def test_a_caller_without_any_code_cannot_read_the_catalog(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    # ⚠ 「查不到权限码」绝不等于匿名放行
    response = await app_client.get(f"{PREFIX}/ac-datasets", headers=sign([]))
    assert response.status_code == 403
    assert response.json()["code"] == 40106


async def test_a_manager_can_read_the_catalog_and_write_limits(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    unit = await make_unit(app_client, "管理员")
    headers = sign([AC_VIEW, AC_MANAGE])
    response = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/metric-limits",
        json={
            "items": [
                {"metric": "workshop_humidity_avg", "lower_limit": "40.00"}
            ]
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["items"][0]["lower_limit"] == "40.00"
