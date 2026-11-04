"""模板直接创建可编辑工作流的快照、权限与幂等契约。"""

from conftest import SignHeaders

from integration.modeling_helpers import PIPELINES, data_of, linear_graph
from integration.test_modeling_templates import TEMPLATES, make_template


async def test_template_creates_independent_editable_workflow_once(app_client):
    template = await make_template(app_client)
    url = f"{TEMPLATES}/{template['id']}:create-workflow"
    payload = {"code": "quick-workflow", "name": "快捷工作流"}
    headers = {"Idempotency-Key": "template-workflow-once"}
    first = await app_client.post(url, json=payload, headers=headers)
    replay = await app_client.post(url, json=payload, headers=headers)
    assert first.status_code == replay.status_code == 201
    created = data_of(first)
    assert created["id"] == data_of(replay)["id"]
    assert first.headers["Location"].endswith(created["id"])
    changed_payload = {**payload, "name": "不同参数"}
    assert (
        await app_client.post(url, json=changed_payload, headers=headers)
    ).status_code == 409
    assert created["graph"]["nodes"][0]["config"]["table_code"] == "energy-data"
    changed = await app_client.patch(
        f"{PIPELINES}/{created['id']}", json={"graph": linear_graph("own-data")}
    )
    assert changed.status_code == 200
    original = data_of(
        await app_client.get(f"{TEMPLATES}/{template['id']}/configuration")
    )
    assert (
        original["configuration"]["nodes"]["s"]["table_code"] == "energy-data"
    )
    assert (
        data_of(await app_client.get("/api/v1/platform/modeling-instances"))[
            "items"
        ]
        == []
    )


async def test_disabled_template_and_missing_design_permission_are_rejected(
    app_client, sign: SignHeaders
):
    template = await make_template(app_client)
    url = f"{TEMPLATES}/{template['id']}:create-workflow"
    payload = {"code": "quick-workflow", "name": "快捷工作流"}
    assert (
        await app_client.post(
            url, json=payload, headers=sign(("modeling:view", "modeling:run"))
        )
    ).status_code == 403
    await app_client.patch(
        f"{TEMPLATES}/{template['id']}", json={"is_enabled": False}
    )
    assert (await app_client.post(url, json=payload)).status_code == 409
