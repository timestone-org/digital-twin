"""建模管理列表的兼容分页、数据库检索与固定关联信息。"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from conftest import SignHeaders
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_helpers import data_of
from integration.modeling_management_helpers import (
    seed_rule_versions,
    seed_versions,
)
from platform_server.app import build_app
from platform_server.apps.modeling.models import (
    ModelingBinding,
    ModelingDeployment,
    ModelingModelVersion,
    ModelingPipeline,
    ModelingRuleVersion,
    ModelingRun,
)
from platform_server.settings import Settings

pytestmark = pytest.mark.requires_postgres
PREFIX = "/api/v1/platform"
STAMP = datetime(2026, 1, 1, tzinfo=UTC)
RESOURCES = ("modeling-bindings", "modeling-deployments")


@dataclass(frozen=True)
class ListRecords:
    pipeline_id: str
    version_ids: list[str]
    bindings: tuple[ModelingBinding, ...]
    deployments: tuple[ModelingDeployment, ...]


@pytest.fixture
async def records(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> ListRecords:
    pipeline_id, versions = await seed_versions(app_client, db_session)
    model = await db_session.get(ModelingModelVersion, uuid.UUID(versions[1]))
    assert model is not None
    model.name = "PinnedNeedle"
    model.description = "ModelDescriptionNeedle"
    model.algo = "AlgorithmNeedle"
    pipeline = await db_session.get(ModelingPipeline, uuid.UUID(pipeline_id))
    assert pipeline is not None
    pipeline.name = "WorkflowNeedle"
    bindings: list[ModelingBinding] = []
    deployments: list[ModelingDeployment] = []
    for seat in range(23):
        version = uuid.UUID(versions[1] if seat == 22 else versions[0])
        binding = ModelingBinding(
            fx_code=f"BIND-{seat:02d}",
            model_version_id=version,
            param_map_json=[],
            param_names_snapshot=[],
            created_at=STAMP + timedelta(seconds=seat),
        )
        deployment = ModelingDeployment(
            code=f"service-{seat:02d}",
            name=f"Service {seat:02d}",
            model_version_id=version,
            revision=1,
            is_enabled=seat != 22,
            created_at=STAMP + timedelta(seconds=seat),
        )
        db_session.add_all([binding, deployment])
        bindings.append(binding)
        deployments.append(deployment)
    await db_session.commit()
    return ListRecords(
        pipeline_id, versions, tuple(bindings), tuple(deployments)
    )


@pytest.mark.parametrize("resource", RESOURCES)
async def test_legacy_arrays_remain_complete_and_pages_count_all_matches(
    app_client: httpx.AsyncClient, records: ListRecords, resource: str
) -> None:
    del records
    url = f"{PREFIX}/{resource}"
    legacy = data_of(await app_client.get(url))
    assert isinstance(legacy, list)
    assert len(legacy) == 23
    pages = [
        data_of(await app_client.get(url, params={"page": page, "size": 10}))
        for page in (1, 2, 3)
    ]
    assert [page["total"] for page in pages] == [23, 23, 23]
    identities = [item["id"] for page in pages for item in page["items"]]
    assert len(identities) == len(set(identities)) == 23
    expected = "BIND-22" if resource == "modeling-bindings" else "service-22"
    key = "fx_code" if resource == "modeling-bindings" else "code"
    assert pages[0]["items"][0][key] == expected
    if resource == "modeling-bindings":
        assert legacy[0]["fx_code"] == "BIND-00"


@pytest.mark.parametrize("resource", RESOURCES)
@pytest.mark.parametrize(
    ("query", "expected"),
    [({"page": 2}, (2, 20, 3)), ({"size": 1}, (1, 1, 1))],
)
async def test_either_paging_parameter_selects_a_bounded_page(
    app_client: httpx.AsyncClient,
    records: ListRecords,
    resource: str,
    query: dict[str, int],
    expected: tuple[int, int, int],
) -> None:
    del records
    page, size, count = expected
    payload = data_of(
        await app_client.get(f"{PREFIX}/{resource}", params=query)
    )
    assert (payload["page"], payload["size"], payload["total"]) == (
        page,
        size,
        23,
    )
    assert len(payload["items"]) == count


@pytest.mark.parametrize(
    ("resource", "keyword", "expected"),
    [
        ("modeling-bindings", "  bind-00  ", ("fx_code", "BIND-00")),
        ("modeling-deployments", "  service 00  ", ("code", "service-00")),
    ],
)
async def test_query_finds_matches_outside_the_first_page(
    app_client: httpx.AsyncClient,
    records: ListRecords,
    resource: str,
    keyword: str,
    expected: tuple[str, str],
) -> None:
    del records
    key, value = expected
    url = f"{PREFIX}/{resource}"
    legacy = data_of(await app_client.get(url, params={"q": keyword}))
    assert isinstance(legacy, list)
    assert [item[key] for item in legacy] == [value]
    page = data_of(await app_client.get(url, params={"q": keyword, "size": 1}))
    assert page["total"] == 1
    assert [item[key] for item in page["items"]] == [value]


@pytest.mark.parametrize("resource", RESOURCES)
@pytest.mark.parametrize("symbol", ["%", "_", "\\"])
async def test_search_metacharacters_are_literal(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    records: ListRecords,
    resource: str,
    symbol: str,
) -> None:
    matching = f"literal{symbol}match"
    if resource == "modeling-bindings":
        records.bindings[0].fx_code = matching
        records.bindings[1].fx_code = "literalXmatch"
    else:
        records.deployments[0].name = matching
        records.deployments[1].name = "literalXmatch"
    await db_session.commit()
    payload = data_of(
        await app_client.get(
            f"{PREFIX}/{resource}",
            params={"q": matching, "page": 1, "size": 10},
        )
    )
    assert payload["total"] == 1
    assert len(payload["items"]) == 1


async def test_deployment_search_combines_existing_false_and_identity_filters(
    app_client: httpx.AsyncClient, records: ListRecords
) -> None:
    response = await app_client.get(
        f"{PREFIX}/modeling-deployments",
        params={
            "q": "pinnedneedle",
            "size": 5,
            "is_enabled": "false",
            "code": "service-22",
            "instance_id": records.pipeline_id,
            "model_version_id": records.version_ids[1],
        },
    )
    assert response.status_code == 200, response.text
    payload = data_of(response)
    assert payload["total"] == 1
    assert payload["items"][0]["code"] == "service-22"
    assert payload["items"][0]["is_enabled"] is False


async def test_binding_page_exposes_the_pinned_model_without_another_page(
    app_client: httpx.AsyncClient, records: ListRecords
) -> None:
    response = await app_client.get(
        f"{PREFIX}/modeling-bindings",
        params={
            "q": "PinnedNeedle",
            "size": 1,
        },
    )
    payload = data_of(response)
    assert payload["total"] == 1
    assert payload["items"][0]["model_version_id"] == records.version_ids[1]
    assert payload["items"][0]["model_name"] == "PinnedNeedle"
    assert payload["items"][0]["model_version"] == 2
    older = data_of(
        await app_client.get(
            f"{PREFIX}/modeling-bindings", params={"q": "BIND-00", "size": 1}
        )
    )
    assert older["items"][0]["model_version_id"] == records.version_ids[0]
    assert older["items"][0]["model_version"] == 1


@pytest.mark.parametrize("resource", RESOURCES)
@pytest.mark.parametrize("keyword", ["", "   "])
async def test_empty_search_is_the_unfiltered_collection(
    app_client: httpx.AsyncClient,
    records: ListRecords,
    resource: str,
    keyword: str,
) -> None:
    del records
    response = await app_client.get(
        f"{PREFIX}/{resource}", params={"q": keyword, "size": 20}
    )
    assert response.status_code == 200, response.text
    assert data_of(response)["total"] == 23


@pytest.mark.parametrize("resource", RESOURCES)
@pytest.mark.parametrize(
    "query", [{"page": 0}, {"size": 0}, {"size": 201}, {"q": "x" * 129}]
)
async def test_new_list_query_bounds_are_enforced(
    app_client: httpx.AsyncClient, resource: str, query: dict[str, int | str]
) -> None:
    response = await app_client.get(f"{PREFIX}/{resource}", params=query)
    assert response.status_code == 400, response.text


@pytest.mark.parametrize(
    "resource", ["modeling-pipelines", "modeling-templates"]
)
async def test_legacy_unbounded_search_length_remains_accepted(
    app_client: httpx.AsyncClient, resource: str
) -> None:
    response = await app_client.get(
        f"{PREFIX}/{resource}", params={"q": "x" * 256}
    )
    assert response.status_code == 200, response.text
    assert data_of(response)["items"] == []


@pytest.mark.parametrize(
    "keyword",
    [
        "PinnedNeedle",
        "AlgorithmNeedle",
        "ModelDescriptionNeedle",
        "WorkflowNeedle",
    ],
)
async def test_version_query_uses_display_and_workflow_fields(
    app_client: httpx.AsyncClient, records: ListRecords, keyword: str
) -> None:
    response = await app_client.get(
        f"{PREFIX}/modeling-model-versions",
        params={"q": keyword.lower(), "size": 20},
    )
    assert response.status_code == 200, response.text
    identities = {item["id"] for item in data_of(response)["items"]}
    assert records.version_ids[1] in identities


async def test_run_query_and_cursor_keep_workflow_metadata_and_scope(
    app_client: httpx.AsyncClient, records: ListRecords
) -> None:
    response = await app_client.get(
        f"{PREFIX}/modeling-runs",
        params={
            "q": "workflowneedle",
            "pagination": "cursor",
            "limit": 1,
        },
    )
    assert response.status_code == 200, response.text
    payload = data_of(response)
    assert payload["has_more"] is True
    assert payload["items"][0]["pipeline_name"] == "WorkflowNeedle"
    assert payload["items"][0]["pipeline_code"]
    assert payload["items"][0]["pipeline_id"] == records.pipeline_id
    changed = await app_client.get(
        f"{PREFIX}/modeling-runs",
        params={
            "q": "different",
            "pagination": "cursor",
            "limit": 1,
            "after": payload["next"],
        },
    )
    assert changed.status_code == 400


@pytest.mark.parametrize("search_field", ["creator", "uuid", "workflow_code"])
async def test_run_search_finds_identity_creator_and_workflow_code(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    records: ListRecords,
    search_field: str,
) -> None:
    model = await db_session.get(
        ModelingModelVersion, uuid.UUID(records.version_ids[0])
    )
    assert model is not None
    run = await db_session.get(ModelingRun, model.run_id)
    pipeline = await db_session.get(
        ModelingPipeline, uuid.UUID(records.pipeline_id)
    )
    assert run is not None
    assert pipeline is not None
    run.created_by_name = "CreatorNeedle"
    await db_session.commit()
    keyword = {
        "creator": "  creatorneedle  ",
        "uuid": str(run.id),
        "workflow_code": pipeline.code.upper(),
    }[search_field]
    result = data_of(
        await app_client.get(f"{PREFIX}/modeling-runs", params={"q": keyword})
    )
    assert str(run.id) in {item["id"] for item in result["items"]}
    assert all(
        item["pipeline_code"] == pipeline.code for item in result["items"]
    )


@pytest.mark.parametrize("resource", RESOURCES)
async def test_related_workflow_names_are_searched_in_the_database(
    app_client: httpx.AsyncClient, records: ListRecords, resource: str
) -> None:
    del records
    response = await app_client.get(
        f"{PREFIX}/{resource}", params={"q": " workflowneedle ", "size": 1}
    )
    assert response.status_code == 200, response.text
    result = data_of(response)
    assert result["total"] == 23
    assert len(result["items"]) == 1


async def test_deployment_search_includes_its_description_and_rule_model(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    records: ListRecords,
) -> None:
    records.deployments[0].description = "ServiceDescriptionNeedle"
    identities = await seed_rule_versions(db_session, records.pipeline_id)
    rule = await db_session.get(ModelingRuleVersion, uuid.UUID(identities[0]))
    assert rule is not None
    rule.name = "FixedRuleNeedle"
    db_session.add(
        ModelingDeployment(
            code="rule-search",
            name="规则入口",
            rule_version_id=rule.id,
            revision=1,
        )
    )
    await db_session.commit()
    description = data_of(
        await app_client.get(
            f"{PREFIX}/modeling-deployments",
            params={"q": "servicedescriptionneedle", "size": 1},
        )
    )
    assert description["total"] == 1
    assert description["items"][0]["code"] == "service-00"
    result = data_of(
        await app_client.get(
            f"{PREFIX}/modeling-deployments",
            params={"q": "fixedruleneedle", "size": 1},
        )
    )
    assert result["total"] == 1
    assert result["items"][0]["model_version_id"] == str(rule.id)
    assert result["items"][0]["task"] == "rule_calculation"


async def cancel_blocked_read(
    client: httpx.AsyncClient, url: str, query_started: asyncio.Event
) -> None:
    pending = asyncio.create_task(client.get(url))
    try:
        await asyncio.wait_for(query_started.wait(), timeout=3)
    finally:
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending


async def test_cancelling_a_blocked_search_preserves_the_collection(
    settings: Settings, sign: SignHeaders
) -> None:
    app = build_app(settings)
    database = app.state.container.database
    query_started = asyncio.Event()

    def observe(**given: object) -> None:
        statement = given.get("statement")
        if isinstance(statement, str) and "modeling_deployments" in statement:
            query_started.set()

    url = f"{PREFIX}/modeling-deployments?size=1"
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://platform-test",
            headers=sign(),
        ) as client:
            before = await client.get(url)
            assert before.status_code == 200, before.text
            async with database.session() as session:
                await session.execute(
                    text(
                        "LOCK TABLE platform.modeling_deployments "
                        "IN ACCESS EXCLUSIVE MODE"
                    )
                )
                event.listen(
                    database.engine.sync_engine,
                    "before_cursor_execute",
                    observe,
                    named=True,
                )
                try:
                    await cancel_blocked_read(client, url, query_started)
                finally:
                    event.remove(
                        database.engine.sync_engine,
                        "before_cursor_execute",
                        observe,
                    )
            after = await client.get(url)
            assert after.status_code == 200, after.text
            assert data_of(after) == data_of(before)
    finally:
        await database.dispose()


async def test_legacy_binding_clients_can_keep_ignored_query_parameters(
    app_client: httpx.AsyncClient, records: ListRecords
) -> None:
    del records
    response = await app_client.get(
        f"{PREFIX}/modeling-bindings", params={"legacy_option": "unchanged"}
    )
    assert response.status_code == 200, response.text
    assert len(data_of(response)) == 23
