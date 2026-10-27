"""模板快照、实例参数原子性与第三方权限的真实数据库契约。"""

import copy

import httpx
import pytest
from conftest import SignHeaders

from integration.modeling_helpers import PIPELINES, data_of, linear_graph

TEMPLATES = "/api/v1/platform/modeling-templates"
INSTANCES = "/api/v1/platform/modeling-instances"


async def make_template(client: httpx.AsyncClient) -> dict:
    pipeline = await client.post(
        PIPELINES,
        json={
            "code": "template-test",
            "name": "能耗模板设计",
            "graph": linear_graph("energy-data"),
        },
    )
    assert pipeline.status_code == 201
    response = await client.post(
        TEMPLATES,
        json={"pipeline_id": data_of(pipeline)["id"], "name": "能耗模板"},
    )
    assert response.status_code == 201
    return data_of(response)


async def make_instance(client: httpx.AsyncClient) -> dict:
    template = await make_template(client)
    response = await client.post(
        INSTANCES,
        json={
            "template_id": template["id"],
            "code": "energy-k1",
            "name": "一号机能耗模型",
        },
    )
    assert response.status_code == 201
    return data_of(response)


async def test_template_snapshot_survives_design_edits(app_client):
    template = await make_template(app_client)
    await app_client.patch(
        f"{PIPELINES}/{template['pipeline_id']}",
        json={"graph": linear_graph("changed-data")},
    )
    response = await app_client.get(
        f"{TEMPLATES}/{template['id']}/configuration"
    )
    assert response.status_code == 200
    assert (
        data_of(response)["configuration"]["nodes"]["s"]["table_code"]
        == "energy-data"
    )
    assert len(data_of(response)["nodes"]) == 6
    assert data_of(response)["json_schema"]["additionalProperties"] is False


async def test_all_configuration_is_atomic_and_revision_protected(app_client):
    instance = await make_instance(app_client)
    url = f"{INSTANCES}/{instance['id']}/configuration"
    configuration = data_of(await app_client.get(url))["configuration"]
    configuration["nodes"]["s"]["table_code"] = "another-data"
    response = await app_client.put(
        url, json={"expected_revision": 1, "configuration": configuration}
    )
    assert response.status_code == 200
    assert data_of(response)["revision"] == 2
    stale = await app_client.put(
        url, json={"expected_revision": 1, "configuration": configuration}
    )
    assert stale.status_code == 409
    invalid = copy.deepcopy(configuration)
    invalid["nodes"]["unknown"] = {}
    rejected = await app_client.put(
        url, json={"expected_revision": 2, "configuration": invalid}
    )
    assert rejected.status_code == 400
    persisted = data_of(await app_client.get(url))
    assert persisted["configuration"] == configuration


async def test_disabled_template_blocks_new_instances(app_client):
    template = await make_template(app_client)
    disabled = await app_client.patch(
        f"{TEMPLATES}/{template['id']}", json={"is_enabled": False}
    )
    assert disabled.status_code == 200
    response = await app_client.post(
        INSTANCES,
        json={
            "template_id": template["id"],
            "code": "disabled",
            "name": "禁用模板",
        },
    )
    assert response.status_code == 409


async def test_third_party_can_instantiate_without_template_design(
    app_client, sign: SignHeaders
):
    template = await make_template(app_client)
    headers = sign(("modeling:view", "modeling:run"))
    created = await app_client.post(
        INSTANCES,
        headers=headers,
        json={
            "template_id": template["id"],
            "code": "partner",
            "name": "第三方模型",
        },
    )
    assert created.status_code == 201
    refused = await app_client.post(
        TEMPLATES,
        headers=headers,
        json={"pipeline_id": template["pipeline_id"], "name": "不能设计"},
    )
    assert refused.status_code == 403


@pytest.mark.parametrize("suffix", ["", "/configuration"])
async def test_instance_read_requires_permission(
    app_client, sign: SignHeaders, suffix
):
    instance = await make_instance(app_client)
    response = await app_client.get(
        f"{INSTANCES}/{instance['id']}{suffix}", headers=sign(())
    )
    assert response.status_code == 403


async def test_instances_keep_independent_parameters_and_design_is_not_editable(
    app_client,
):
    first = await make_instance(app_client)
    second = data_of(
        await app_client.post(
            INSTANCES,
            json={
                "template_id": first["template_id"],
                "code": "energy-k2",
                "name": "二号机",
            },
        )
    )
    url = f"{INSTANCES}/{first['id']}/configuration"
    config = data_of(await app_client.get(url))["configuration"]
    config["nodes"]["s"]["table_code"] = "k1-only"
    assert (
        await app_client.put(
            url, json={"expected_revision": 1, "configuration": config}
        )
    ).status_code == 200
    other = data_of(
        await app_client.get(f"{INSTANCES}/{second['id']}/configuration")
    )
    assert other["configuration"]["nodes"]["s"]["table_code"] == "energy-data"
    assert (
        await app_client.patch(
            f"{PIPELINES}/{first['id']}", json={"graph": linear_graph("bypass")}
        )
    ).status_code == 409
    listed = data_of(
        await app_client.get(PIPELINES, params={"include_instances": "false"})
    )
    assert [row["code"] for row in listed["items"]] == ["template-test"]


async def test_template_versions_and_creation_are_idempotent(app_client):
    template = await make_template(app_client)
    payload = {"pipeline_id": template["pipeline_id"], "name": "新版"}
    headers = {"Idempotency-Key": "template-publication-once"}
    first = await app_client.post(TEMPLATES, json=payload, headers=headers)
    replay = await app_client.post(TEMPLATES, json=payload, headers=headers)
    assert first.status_code == replay.status_code == 201
    assert data_of(first)["version"] == 2
    assert data_of(first)["id"] == data_of(replay)["id"]
    assert first.headers["location"].endswith(data_of(first)["id"])


async def test_training_is_idempotent_and_locks_configuration(app_client):
    instance = await make_instance(app_client)
    url = f"{INSTANCES}/{instance['id']}:train"
    headers = {"Idempotency-Key": "train-once"}
    first = await app_client.post(url, json={"trigger": "api"}, headers=headers)
    replay = await app_client.post(
        url, json={"trigger": "api"}, headers=headers
    )
    assert first.status_code == replay.status_code == 202
    assert data_of(first)["id"] == data_of(replay)["id"]
    assert (
        await app_client.post(url, json={"trigger": "api"})
    ).status_code == 409
    config_url = f"{INSTANCES}/{instance['id']}/configuration"
    configuration = data_of(await app_client.get(config_url))["configuration"]
    assert (
        await app_client.put(
            config_url,
            json={"expected_revision": 1, "configuration": configuration},
        )
    ).status_code == 409


@pytest.mark.parametrize("change", ["missing", "bad_config", "extra_config"])
async def test_invalid_configuration_never_changes_revision(app_client, change):
    instance = await make_instance(app_client)
    url = f"{INSTANCES}/{instance['id']}/configuration"
    config = data_of(await app_client.get(url))["configuration"]
    if change == "missing":
        del config["nodes"]["s"]
    elif change == "bad_config":
        config["nodes"]["p"]["test_ratio"] = 5
    else:
        config["nodes"]["m"]["not_a_parameter"] = "ignored?"
    response = await app_client.put(
        url, json={"expected_revision": 1, "configuration": config}
    )
    assert response.status_code == 400
    assert (
        data_of(await app_client.get(f"{INSTANCES}/{instance['id']}"))[
            "revision"
        ]
        == 1
    )


async def test_lists_and_configuration_snapshot_include_matching_identity(
    app_client,
):
    instance = await make_instance(app_client)
    templates = data_of(
        await app_client.get(TEMPLATES, params={"q": "能耗", "size": 1})
    )
    models = data_of(
        await app_client.get(INSTANCES, params={"q": "energy-k1", "size": 1})
    )
    assert templates["total"] == models["total"] == 1
    assert models["items"][0]["id"] == instance["id"]
    assert (
        data_of(await app_client.get(f"{TEMPLATES}/{instance['template_id']}"))[
            "version"
        ]
        == 1
    )
    snapshot = data_of(
        await app_client.get(f"{INSTANCES}/{instance['id']}/configuration")
    )
    assert snapshot["instance"]["revision"] == 1
    assert snapshot["instance"]["name"] == "一号机能耗模型"
    assert (
        snapshot["configuration"]["nodes"]["s"]["table_code"] == "energy-data"
    )
    combined = data_of(await app_client.get(PIPELINES))
    assert instance["id"] in {row["id"] for row in combined["items"]}


@pytest.mark.parametrize("path", [TEMPLATES, INSTANCES])
async def test_missing_resources_fail_explicitly(app_client, path):
    absent = "00000000-0000-4000-8000-000000000123"
    assert (await app_client.get(f"{path}/{absent}")).status_code == 404
    assert (
        await app_client.get(f"{path}/{absent}/configuration")
    ).status_code == 404


async def test_empty_design_cannot_be_published(app_client):
    pipeline = data_of(
        await app_client.post(
            PIPELINES, json={"code": "empty-design", "name": "未完成"}
        )
    )
    response = await app_client.post(
        TEMPLATES, json={"pipeline_id": pipeline["id"], "name": "未完成"}
    )
    assert response.status_code == 400
    assert data_of(await app_client.get(TEMPLATES))["total"] == 0
