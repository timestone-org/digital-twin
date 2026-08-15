"""模板库：另存为、按分类翻墙、实例化到任意项目。

⚠ 模板与来源脱钩——建模板那一刻包与缩略图就落地了，源屏改版不回溯，
源屏删掉模板照样能实例化；而列表项不许带整包，一页 20 条就是十几 MB。
"""

import uuid
from typing import Any

import httpx
import pytest
from conftest import SEEDED_SOURCE_ID, SignHeaders

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    data_of,
    make_dashboard,
    make_project,
)
from platform_server.apps.dashboard.catalog import (
    DASHBOARD_EDIT,
    DASHBOARD_VIEW,
)
from platform_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

TEMPLATES_URL = f"{API_PREFIX}/dashboard-templates"
HTTP_OK = 200
HTTP_FORBIDDEN = 403
KNOWN_KEY = f"{SEEDED_SOURCE_ID}:outlet_temp"
MISSING_KEY = f"{SEEDED_SOURCE_ID}:nowhere"
MISSING_ID = "00000000-0000-7000-8000-000000000000"
THUMBNAIL = "data:image/png;base64,iVBORw0KGgo="
LATER_THUMBNAIL = "data:image/png;base64,AAAA"
TEMPLATE_NAME = "光伏总览模板"
TEMPLATE_NOT_FOUND = 41015
EDITOR = (DASHBOARD_VIEW, DASHBOARD_EDIT)
BINDING = {
    "field_key": "anchorValues[0].value",
    "source_kind": "opcua",
    "node_key": KNOWN_KEY,
}


def page_of(response: httpx.Response) -> list[dict[str, Any]]:
    """取分页信封里的 `items`。

    Args: response。
    """
    items = data_of(response)["items"]
    assert isinstance(items, list)
    return items


async def source_screen(client: httpx.AsyncClient) -> dict[str, Any]:
    """建一个项目加一张放好树的大屏：页头 + 挂实时绑定的孪生视图。

    Args: client。
    """
    project_id = await make_project(client)
    screen = await make_dashboard(
        client, project_id=project_id, name="光伏总览"
    )
    top_id = str(uuid.uuid4())
    await client.post(
        f"{DASHBOARDS_URL}/{screen['id']}:replace-layout",
        json={
            "expected_version": 1,
            "nodes": [
                {
                    "id": top_id,
                    "module_type": "header",
                    "client_key": "top",
                    "x": 0,
                    "y": 0,
                    "w": 1920,
                    "h": 96,
                    "bindings": [],
                },
                {
                    "module_type": "twin-view",
                    "parent_id": top_id,
                    "x": 10,
                    "y": 20,
                    "w": 400,
                    "h": 300,
                    "bindings": [BINDING],
                },
            ],
        },
    )
    return screen


async def put_thumbnail(
    client: httpx.AsyncClient, dashboard_id: str, data: str = THUMBNAIL
) -> None:
    """给一张大屏存一张缩略图。

    Args: client, dashboard_id, data。
    """
    response = await client.put(
        f"{DASHBOARDS_URL}/{dashboard_id}/thumbnail", json={"data": data}
    )
    assert response.status_code == HTTP_OK


async def save_as_template(
    client: httpx.AsyncClient,
    dashboard_id: str,
    name: str = TEMPLATE_NAME,
    category: str = "光伏",
) -> dict[str, Any]:
    """把一张大屏另存为模板并回它的详情。

    Args: client, dashboard_id, name, category。
    """
    response = await client.post(
        TEMPLATES_URL,
        json={
            "source_dashboard_id": dashboard_id,
            "name": name,
            "category": category,
        },
    )
    assert response.status_code == HTTP_CREATED
    return data_of(response)


async def wall_entry(
    client: httpx.AsyncClient,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """一张放好树的源屏，加一条按它另存出来的模板。

    Args: client。
    """
    source = await source_screen(client)
    return source, await save_as_template(client, str(source["id"]))


async def instantiate(
    client: httpx.AsyncClient,
    template_id: str,
    project_id: str,
    name: str | None = None,
) -> httpx.Response:
    """从模板实例化一张大屏。

    Args: client, template_id, project_id, name。
    """
    body: dict[str, Any] = {"target_project_id": project_id}
    if name is not None:
        body["name"] = name
    return await client.post(
        f"{TEMPLATES_URL}/{template_id}:instantiate", json=body
    )


async def dangling_entry(
    client: httpx.AsyncClient,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """一张带「指向本部署没有的点位」的绑定的屏，加它的模板。

    ⚠ 这张屏只能从导入面进：写入面会把这条绑定当场拒掉，而导入面容忍它。
    Args: client。
    """
    source = await source_screen(client)
    exported = await client.post(f"{DASHBOARDS_URL}/{source['id']}:export")
    package = data_of(exported)
    package["nodes"][1]["bindings"][0]["node_key"] = MISSING_KEY
    imported = await client.post(
        f"{DASHBOARDS_URL}:import",
        json={"project_id": source["project_id"], "payload": package},
    )
    screen = data_of(imported)
    return screen, await save_as_template(client, str(screen["id"]))


def bound_keys(payload: dict[str, Any]) -> list[str]:
    """一张屏上全部绑定指向的点位。

    Args: payload。
    """
    return [
        binding["node_key"]
        for node in payload["nodes"]
        for binding in node["bindings"]
    ]


async def test_saving_a_screen_as_a_template_reports_where_it_came_from(
    app_client: httpx.AsyncClient,
) -> None:
    source, template = await wall_entry(app_client)
    assert template["source_project_id"] == source["project_id"]
    assert template["name"] == TEMPLATE_NAME


async def test_a_new_template_points_at_itself_in_the_location_header(
    app_client: httpx.AsyncClient,
) -> None:
    source = await source_screen(app_client)
    response = await app_client.post(
        TEMPLATES_URL,
        json={"source_dashboard_id": source["id"], "name": "模板"},
    )
    created = data_of(response)
    assert response.headers["Location"] == f"{TEMPLATES_URL}/{created['id']}"


async def test_the_template_package_is_what_exporting_the_screen_gives(
    app_client: httpx.AsyncClient,
) -> None:
    source, template = await wall_entry(app_client)
    exported = await app_client.post(f"{DASHBOARDS_URL}/{source['id']}:export")
    assert template["payload"] == data_of(exported)


async def test_the_template_takes_a_copy_of_the_source_thumbnail(
    app_client: httpx.AsyncClient,
) -> None:
    source = await source_screen(app_client)
    bare = await save_as_template(app_client, str(source["id"]), "无图")
    await put_thumbnail(app_client, str(source["id"]))
    covered = await save_as_template(app_client, str(source["id"]), "有图")
    assert (bare["thumbnail"], covered["thumbnail"]) == (None, THUMBNAIL)


async def test_the_copied_thumbnail_does_not_follow_the_source_later(
    app_client: httpx.AsyncClient,
) -> None:
    # 拷一份而不是引用一张：源屏之后改版，模板墙上的封面不该跟着变
    source = await source_screen(app_client)
    await put_thumbnail(app_client, str(source["id"]))
    template = await save_as_template(app_client, str(source["id"]))
    await put_thumbnail(app_client, str(source["id"]), LATER_THUMBNAIL)
    again = await app_client.get(f"{TEMPLATES_URL}/{template['id']}")
    assert data_of(again)["thumbnail"] == THUMBNAIL


async def test_saving_a_template_leaves_the_source_screen_untouched(
    app_client: httpx.AsyncClient,
) -> None:
    source = await source_screen(app_client)
    before = await app_client.get(f"{DASHBOARDS_URL}/{source['id']}")
    await save_as_template(app_client, str(source["id"]))
    after = await app_client.get(f"{DASHBOARDS_URL}/{source['id']}")
    assert data_of(after) == data_of(before)


async def test_saving_from_a_screen_that_is_not_there_is_a_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        TEMPLATES_URL, json={"source_dashboard_id": MISSING_ID, "name": "模板"}
    )
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == 41002


async def test_an_editor_cannot_add_to_the_template_wall(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    source = await source_screen(app_client)
    response = await app_client.post(
        TEMPLATES_URL,
        json={"source_dashboard_id": source["id"], "name": "模板"},
        headers=sign(EDITOR),
    )
    assert response.status_code == HTTP_FORBIDDEN


async def test_replaying_one_key_saves_a_single_template(
    app_client: httpx.AsyncClient,
) -> None:
    source = await source_screen(app_client)
    body = {"source_dashboard_id": source["id"], "name": "模板"}
    headers = {"Idempotency-Key": "save-once"}
    first = await app_client.post(TEMPLATES_URL, json=body, headers=headers)
    second = await app_client.post(TEMPLATES_URL, json=body, headers=headers)
    assert data_of(second)["id"] == data_of(first)["id"]
    assert len(page_of(await app_client.get(TEMPLATES_URL))) == 1


async def test_the_wall_is_empty_before_anyone_saves_a_template(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(TEMPLATES_URL)
    assert response.status_code == HTTP_OK
    assert page_of(response) == []


async def test_a_listed_template_never_carries_the_package(
    app_client: httpx.AsyncClient,
) -> None:
    # 整包几百 KB，一页 20 条就是十几 MB
    await wall_entry(app_client)
    assert "payload" not in page_of(await app_client.get(TEMPLATES_URL))[0]


async def test_a_listed_template_carries_what_the_wall_renders(
    app_client: httpx.AsyncClient,
) -> None:
    source = await source_screen(app_client)
    await put_thumbnail(app_client, str(source["id"]))
    await save_as_template(app_client, str(source["id"]))
    listed = page_of(await app_client.get(TEMPLATES_URL))[0]
    assert (listed["name"], listed["category"], listed["thumbnail"]) == (
        TEMPLATE_NAME,
        "光伏",
        THUMBNAIL,
    )


async def test_filtering_by_category_leaves_the_other_shelves_out(
    app_client: httpx.AsyncClient,
) -> None:
    source = await source_screen(app_client)
    await save_as_template(app_client, str(source["id"]), "光伏一")
    await save_as_template(app_client, str(source["id"]), "储能一", "储能")
    listed = page_of(
        await app_client.get(TEMPLATES_URL, params={"category": "储能"})
    )
    assert [item["name"] for item in listed] == ["储能一"]


async def test_an_unknown_category_lists_nothing_rather_than_everything(
    app_client: httpx.AsyncClient,
) -> None:
    await wall_entry(app_client)
    listed = await app_client.get(TEMPLATES_URL, params={"category": "风电"})
    assert page_of(listed) == []


async def test_the_wall_pages_and_reports_the_whole_count(
    app_client: httpx.AsyncClient,
) -> None:
    source = await source_screen(app_client)
    for index in range(3):
        await save_as_template(app_client, str(source["id"]), f"模板{index}")
    response = await app_client.get(TEMPLATES_URL, params={"size": 2})
    assert len(page_of(response)) == 2
    assert data_of(response)["total"] == 3


async def test_a_viewer_can_browse_the_wall(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.get(
        TEMPLATES_URL, headers=sign([DASHBOARD_VIEW])
    )
    assert response.status_code == HTTP_OK


async def test_reading_a_template_gives_the_whole_package(
    app_client: httpx.AsyncClient,
) -> None:
    _, template = await wall_entry(app_client)
    response = await app_client.get(f"{TEMPLATES_URL}/{template['id']}")
    assert response.status_code == HTTP_OK
    assert len(data_of(response)["payload"]["nodes"]) == 2


async def test_reading_a_template_that_is_not_there_is_a_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{TEMPLATES_URL}/{MISSING_ID}")
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == TEMPLATE_NOT_FOUND


async def test_a_deleted_template_leaves_the_wall(
    app_client: httpx.AsyncClient,
) -> None:
    _, template = await wall_entry(app_client)
    removed = await app_client.delete(f"{TEMPLATES_URL}/{template['id']}")
    assert removed.status_code == HTTP_NO_CONTENT
    assert page_of(await app_client.get(TEMPLATES_URL)) == []


async def test_deleting_a_template_that_is_not_there_is_a_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.delete(f"{TEMPLATES_URL}/{MISSING_ID}")
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == TEMPLATE_NOT_FOUND


async def test_an_editor_cannot_take_a_template_off_the_wall(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    _, template = await wall_entry(app_client)
    response = await app_client.delete(
        f"{TEMPLATES_URL}/{template['id']}", headers=sign(EDITOR)
    )
    assert response.status_code == HTTP_FORBIDDEN


async def test_deleting_a_template_leaves_the_screens_it_made_alone(
    app_client: httpx.AsyncClient,
) -> None:
    source, template = await wall_entry(app_client)
    made = await instantiate(
        app_client, str(template["id"]), str(source["project_id"])
    )
    await app_client.delete(f"{TEMPLATES_URL}/{template['id']}")
    still = await app_client.get(f"{DASHBOARDS_URL}/{data_of(made)['id']}")
    assert still.status_code == HTTP_OK


async def test_a_template_outlives_the_screen_it_came_from(
    app_client: httpx.AsyncClient,
) -> None:
    # 模板本就是拿来跨项目复用的，跟着来源一起消失就没有复用可言
    source, template = await wall_entry(app_client)
    await app_client.delete(f"{DASHBOARDS_URL}/{source['id']}")
    response = await instantiate(
        app_client, str(template["id"]), str(source["project_id"])
    )
    assert response.status_code == HTTP_CREATED


async def test_instantiating_lands_a_new_screen_in_the_named_project(
    app_client: httpx.AsyncClient,
) -> None:
    _, template = await wall_entry(app_client)
    elsewhere = await make_project(app_client, name="储能")
    response = await instantiate(app_client, str(template["id"]), elsewhere)
    made = data_of(response)
    assert response.status_code == HTTP_CREATED
    assert made["project_id"] == elsewhere
    assert len(made["nodes"]) == 2


async def test_a_new_screen_points_at_itself_in_the_location_header(
    app_client: httpx.AsyncClient,
) -> None:
    source, template = await wall_entry(app_client)
    response = await instantiate(
        app_client, str(template["id"]), str(source["project_id"])
    )
    made = data_of(response)
    assert response.headers["Location"] == f"{DASHBOARDS_URL}/{made['id']}"


async def test_an_instantiated_screen_is_named_after_the_template(
    app_client: httpx.AsyncClient,
) -> None:
    # 包里那个名字是另存为那一刻源屏的名字，用户在墙上认的是模板名
    source, template = await wall_entry(app_client)
    response = await instantiate(
        app_client, str(template["id"]), str(source["project_id"])
    )
    assert data_of(response)["name"] == TEMPLATE_NAME


async def test_an_instantiated_screen_can_be_named_on_the_way_in(
    app_client: httpx.AsyncClient,
) -> None:
    source, template = await wall_entry(app_client)
    response = await instantiate(
        app_client, str(template["id"]), str(source["project_id"]), "二号屏"
    )
    assert data_of(response)["name"] == "二号屏"


async def test_an_instantiated_screen_gets_its_own_identifiers(
    app_client: httpx.AsyncClient,
) -> None:
    source, template = await wall_entry(app_client)
    response = await instantiate(
        app_client, str(template["id"]), str(source["project_id"])
    )
    original = await app_client.get(f"{DASHBOARDS_URL}/{source['id']}")
    made = data_of(response)
    assert made["id"] != source["id"]
    assert {node["id"] for node in made["nodes"]}.isdisjoint(
        {node["id"] for node in data_of(original)["nodes"]}
    )


async def test_instantiating_twice_gives_two_independent_screens(
    app_client: httpx.AsyncClient,
) -> None:
    source, template = await wall_entry(app_client)
    project_id = str(source["project_id"])
    first = await instantiate(app_client, str(template["id"]), project_id)
    second = await instantiate(app_client, str(template["id"]), project_id)
    assert data_of(first)["id"] != data_of(second)["id"]


async def test_an_instantiated_screen_carries_the_bindings(
    app_client: httpx.AsyncClient,
) -> None:
    source, template = await wall_entry(app_client)
    response = await instantiate(
        app_client, str(template["id"]), str(source["project_id"])
    )
    assert bound_keys(data_of(response)) == [KNOWN_KEY]


async def test_a_resolvable_template_reports_nothing_unresolved(
    app_client: httpx.AsyncClient,
) -> None:
    source, template = await wall_entry(app_client)
    response = await instantiate(
        app_client, str(template["id"]), str(source["project_id"])
    )
    assert data_of(response)["unresolved_bindings"] == []


async def test_a_binding_to_a_missing_point_is_reported_not_dropped(
    app_client: httpx.AsyncClient,
) -> None:
    # 静默丢绑定会让用户以为按模板建出来的是一张能用的屏
    source, template = await dangling_entry(app_client)
    response = await instantiate(
        app_client, str(template["id"]), str(source["project_id"])
    )
    assert data_of(response)["unresolved_bindings"] == [
        {
            "node_key": MISSING_KEY,
            "field_key": "anchorValues[0].value",
            "source_kind": "opcua",
            "reason": "point_not_found",
        }
    ]


async def test_a_reported_binding_is_still_written_to_the_new_screen(
    app_client: httpx.AsyncClient,
) -> None:
    source, template = await dangling_entry(app_client)
    response = await instantiate(
        app_client, str(template["id"]), str(source["project_id"])
    )
    assert bound_keys(data_of(response)) == [MISSING_KEY]


async def test_instantiating_a_template_that_is_not_there_is_a_404(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    response = await instantiate(app_client, MISSING_ID, project_id)
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == TEMPLATE_NOT_FOUND


async def test_instantiating_into_a_project_that_is_not_there_is_a_404(
    app_client: httpx.AsyncClient,
) -> None:
    _, template = await wall_entry(app_client)
    response = await instantiate(app_client, str(template["id"]), MISSING_ID)
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == 41001


async def test_a_refused_instantiation_leaves_no_screen_behind(
    app_client: httpx.AsyncClient,
) -> None:
    source, template = await wall_entry(app_client)
    await instantiate(app_client, str(template["id"]), MISSING_ID)
    listed = await app_client.get(
        DASHBOARDS_URL, params={"project_id": source["project_id"]}
    )
    assert listed.json()["data"]["total"] == 1


async def test_an_editor_cannot_instantiate_a_template(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    source, template = await wall_entry(app_client)
    response = await app_client.post(
        f"{TEMPLATES_URL}/{template['id']}:instantiate",
        json={"target_project_id": source["project_id"]},
        headers=sign(EDITOR),
    )
    assert response.status_code == HTTP_FORBIDDEN


async def test_replaying_one_key_instantiates_a_single_screen(
    app_client: httpx.AsyncClient,
) -> None:
    source, template = await wall_entry(app_client)
    url = f"{TEMPLATES_URL}/{template['id']}:instantiate"
    body = {"target_project_id": source["project_id"]}
    headers = {"Idempotency-Key": "instantiate-once"}
    first = await app_client.post(url, json=body, headers=headers)
    second = await app_client.post(url, json=body, headers=headers)
    assert data_of(second)["id"] == data_of(first)["id"]
