"""模板与实例在训练前返回模型类型，来源编辑不改变既有类型。"""

import httpx

from integration.modeling_helpers import (
    PIPELINES,
    create_pipeline,
    data_of,
    edge,
    node,
)
from integration.test_modeling_templates import (
    INSTANCES,
    TEMPLATES,
    make_instance,
)


def _rule_graph() -> dict[str, object]:
    return {
        "format_version": "1.0",
        "nodes": [
            node("source", "ledger_source", table_code="conditions"),
            node("rules", "energy_rules", kind="hvac_compliance"),
        ],
        "edges": [edge("input", "source", "frame", "rules", "frame")],
    }


async def _instance(
    client: httpx.AsyncClient, template_id: str, code: str
) -> dict:
    response = await client.post(
        INSTANCES,
        json={"template_id": template_id, "code": code, "name": code},
    )
    assert response.status_code == 201, response.text
    return data_of(response)


async def test_model_types_are_available_before_training(
    app_client: httpx.AsyncClient,
) -> None:
    pipeline = await create_pipeline(app_client, "rule-design", _rule_graph())
    response = await app_client.post(
        TEMPLATES,
        json={"pipeline_id": pipeline["id"], "name": "工况规则模板"},
    )
    assert response.status_code == 201, response.text
    template = data_of(response)
    instance = await _instance(app_client, template["id"], "rule-instance")
    assert template["task"] == instance["task"] == "rule_calculation"
    assert instance["latest_run"] is None
    for path in (TEMPLATES, INSTANCES):
        listed = data_of(await app_client.get(path))
        assert listed["items"][0]["task"] == "rule_calculation"
    for path, resource in ((TEMPLATES, template), (INSTANCES, instance)):
        detail = data_of(await app_client.get(f"{path}/{resource['id']}"))
        assert detail["task"] == "rule_calculation"


async def test_republishing_a_different_task_keeps_old_templates_and_instances(
    app_client: httpx.AsyncClient,
) -> None:
    original = await make_instance(app_client)
    template = data_of(
        await app_client.get(f"{TEMPLATES}/{original['template_id']}")
    )
    edited = await app_client.patch(
        f"{PIPELINES}/{template['pipeline_id']}", json={"graph": _rule_graph()}
    )
    assert edited.status_code == 200, edited.text
    published = await app_client.post(
        TEMPLATES,
        json={"pipeline_id": template["pipeline_id"], "name": "工况规则模板"},
    )
    assert published.status_code == 201, published.text
    current = data_of(published)
    new_instance = await _instance(app_client, current["id"], "rules-v2")
    assert current["version"] == 2
    assert current["task"] == new_instance["task"] == "rule_calculation"
    old_template = data_of(
        await app_client.get(f"{TEMPLATES}/{template['id']}")
    )
    old_instance = data_of(
        await app_client.get(f"{INSTANCES}/{original['id']}")
    )
    assert old_template["task"] == old_instance["task"] == "regression"
    assert old_instance["template_id"] == template["id"]
    assert old_instance["template_version"] == 1
