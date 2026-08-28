"""会话面的端到端契约：归属、幂等、归档与列表顺序。

⚠ 最要紧的一条是「别人的会话回 404 而不是 403」——403 等于逐个 id 回答
「这条对话确实存在」，而会话 id 拿得到就能试。
"""

import uuid
from collections.abc import Callable

import httpx
import pytest

pytestmark = pytest.mark.requires_postgres

# 身份头工厂的形状。⚠ 不从 conftest import：workspace 里每个服务都有一个顶层
# `tests` 包，那条 import 会解析到别的服务的 conftest
HeaderFactory = Callable[..., dict[str, str]]

SESSIONS_URL = "/api/v1/assistant/sessions"
CAPABILITIES_URL = "/api/v1/assistant/capabilities"
ASSISTANT_USE = "assistant:use"
DEFAULT_SURFACE = "dashboard-editor"


def _data(response: httpx.Response) -> dict[str, object]:
    body = response.json()
    assert isinstance(body, dict)
    payload = body["data"]
    assert isinstance(payload, dict)
    return payload


def _items(response: httpx.Response) -> list[dict[str, object]]:
    page = _data(response)
    rows = page["items"]
    assert isinstance(rows, list)
    return rows


async def _create(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    *,
    surface_kind: str = DEFAULT_SURFACE,
    title: str = "",
) -> dict[str, object]:
    response = await client.post(
        SESSIONS_URL,
        headers=headers,
        json={"surface_kind": surface_kind, "title": title},
    )
    assert response.status_code == 201
    return _data(response)


async def test_a_session_can_live_on_the_2d_twin_surface(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    """新工作面同时要过 schema 的闭合集合与库里那条 CHECK。

    ⚠ 只改 `SURFACE_KINDS` 不迁移的话，用例在 SQLite 上全绿、真库上每一次
    建会话都是 500——而 CHECK 是建表时定死的。
    """
    created = await _create(
        db_client, sign([ASSISTANT_USE]), surface_kind="twin2d-editor"
    )
    assert created["surface_kind"] == "twin2d-editor"


async def test_a_new_session_belongs_to_its_caller(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    headers = sign([ASSISTANT_USE])
    created = await _create(db_client, headers, title="配一张光伏屏")
    assert created["user_id"] == headers["X-Auth-User-Id"]
    assert created["title"] == "配一张光伏屏"
    assert created["row_version"] == 1
    assert created["is_archived"] is False


async def test_a_new_session_is_listed_for_its_owner(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    headers = sign([ASSISTANT_USE])
    created = await _create(db_client, headers)
    response = await db_client.get(SESSIONS_URL, headers=headers)
    assert response.status_code == 200
    assert [row["id"] for row in _items(response)] == [created["id"]]


async def test_another_callers_session_is_absent_from_the_list(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    await _create(db_client, sign([ASSISTANT_USE]))
    response = await db_client.get(SESSIONS_URL, headers=sign([ASSISTANT_USE]))
    assert _items(response) == []


async def test_another_callers_session_reads_as_missing_not_forbidden(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    created = await _create(db_client, sign([ASSISTANT_USE]))
    response = await db_client.get(
        f"{SESSIONS_URL}/{created['id']}", headers=sign([ASSISTANT_USE])
    )
    assert response.status_code == 404
    assert response.json()["code"] == 42201


async def test_another_callers_session_cannot_be_deleted(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    created = await _create(db_client, sign([ASSISTANT_USE]))
    response = await db_client.delete(
        f"{SESSIONS_URL}/{created['id']}", headers=sign([ASSISTANT_USE])
    )
    assert response.status_code == 404


async def test_a_session_detail_starts_with_no_messages(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    headers = sign([ASSISTANT_USE])
    created = await _create(db_client, headers)
    response = await db_client.get(
        f"{SESSIONS_URL}/{created['id']}", headers=headers
    )
    assert _data(response)["messages"] == []


async def test_a_replayed_idempotency_key_creates_one_session(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    headers = {**sign([ASSISTANT_USE]), "Idempotency-Key": str(uuid.uuid4())}
    body = {"surface_kind": DEFAULT_SURFACE, "title": "只该建一条"}
    first = await db_client.post(SESSIONS_URL, headers=headers, json=body)
    second = await db_client.post(SESSIONS_URL, headers=headers, json=body)
    assert first.status_code == 201
    assert _data(second)["id"] == _data(first)["id"]
    listed = await db_client.get(SESSIONS_URL, headers=headers)
    assert len(_items(listed)) == 1


async def test_renaming_a_session_advances_its_row_version(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    headers = sign([ASSISTANT_USE])
    created = await _create(db_client, headers)
    response = await db_client.patch(
        f"{SESSIONS_URL}/{created['id']}",
        headers=headers,
        json={"title": "改过的标题"},
    )
    assert response.status_code == 200
    assert _data(response)["title"] == "改过的标题"
    assert _data(response)["row_version"] == 2


async def test_an_empty_patch_leaves_the_row_version_alone(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    headers = sign([ASSISTANT_USE])
    created = await _create(db_client, headers)
    response = await db_client.patch(
        f"{SESSIONS_URL}/{created['id']}", headers=headers, json={}
    )
    assert _data(response)["row_version"] == 1


async def test_an_archived_session_is_kept_and_filterable(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    headers = sign([ASSISTANT_USE])
    created = await _create(db_client, headers)
    await db_client.patch(
        f"{SESSIONS_URL}/{created['id']}",
        headers=headers,
        json={"is_archived": True},
    )
    live = await db_client.get(
        SESSIONS_URL, headers=headers, params={"is_archived": "false"}
    )
    archived = await db_client.get(
        SESSIONS_URL, headers=headers, params={"is_archived": "true"}
    )
    assert _items(live) == []
    assert [row["id"] for row in _items(archived)] == [created["id"]]


async def test_a_deleted_session_reads_as_missing(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    headers = sign([ASSISTANT_USE])
    created = await _create(db_client, headers)
    removed = await db_client.delete(
        f"{SESSIONS_URL}/{created['id']}", headers=headers
    )
    reread = await db_client.get(
        f"{SESSIONS_URL}/{created['id']}", headers=headers
    )
    assert removed.status_code == 204
    assert reread.status_code == 404


async def test_the_list_puts_the_most_recently_updated_first(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    headers = sign([ASSISTANT_USE])
    older = await _create(db_client, headers, title="先建的")
    newer = await _create(db_client, headers, title="后建的")
    await db_client.patch(
        f"{SESSIONS_URL}/{older['id']}",
        headers=headers,
        json={"title": "又动过的"},
    )
    response = await db_client.get(SESSIONS_URL, headers=headers)
    assert [row["id"] for row in _items(response)] == [
        older["id"],
        newer["id"],
    ]


async def test_the_surface_kind_filter_narrows_the_list(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    headers = sign([ASSISTANT_USE])
    await _create(db_client, headers, surface_kind="dashboard-editor")
    twin = await _create(db_client, headers, surface_kind="twin-editor")
    response = await db_client.get(
        SESSIONS_URL, headers=headers, params={"surface_kind": "twin-editor"}
    )
    assert [row["id"] for row in _items(response)] == [twin["id"]]


async def test_an_unregistered_surface_kind_is_refused(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    response = await db_client.get(
        SESSIONS_URL,
        headers=sign([ASSISTANT_USE]),
        params={"surface_kind": "dashboard-editorr"},
    )
    assert response.status_code == 400


async def test_a_caller_without_the_code_is_refused(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    response = await db_client.get(
        SESSIONS_URL, headers=sign(["dashboard:view"])
    )
    assert response.status_code == 403


async def test_a_created_session_answers_with_its_location(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    headers = sign([ASSISTANT_USE])
    response = await db_client.post(
        SESSIONS_URL,
        headers=headers,
        json={"surface_kind": DEFAULT_SURFACE},
    )
    created = _data(response)
    assert response.headers["Location"] == f"{SESSIONS_URL}/{created['id']}"


async def test_a_session_remembers_which_model_it_was_switched_to(
    db_client: httpx.AsyncClient,
) -> None:
    """换模型是会话级的选择。

    ⚠ 存在会话上而不是每次请求带：工具回填那几次推进是循环自己发的，
    那时前端手上没有用户的选择，只有落在会话上才带得过去。
    """
    created = await db_client.post(
        SESSIONS_URL, json={"surface_kind": "dashboard-editor"}
    )
    session_id = created.json()["data"]["id"]
    patched = await db_client.patch(
        f"{SESSIONS_URL}/{session_id}",
        json={"model_profile": "codex", "reasoning_effort": "high"},
    )
    assert patched.status_code == 200
    body = patched.json()["data"]
    assert body["model_profile"] == "codex"
    assert body["reasoning_effort"] == "high"


async def test_an_unknown_model_profile_is_rejected(
    db_client: httpx.AsyncClient,
) -> None:
    # 放行的话它会落进会话行，而取模型那一层认不出就退回默认——
    # 界面上显示「用的是订阅账号」而实际走的是按量端点，账单上才看得出来
    created = await db_client.post(
        SESSIONS_URL, json={"surface_kind": "dashboard-editor"}
    )
    session_id = created.json()["data"]["id"]
    rejected = await db_client.patch(
        f"{SESSIONS_URL}/{session_id}", json={"model_profile": "没这一路"}
    )
    assert rejected.status_code == 400


def _default_route(capability: dict[str, object]) -> tuple[object, object]:
    """能力端点报的默认那一路，以及它该配的推理档。

    ⚠ 推理档只有「有这一档的路」才该带：按量那一路吃不到它。

    Args: capability。
    """
    listed = capability["models"]
    assert isinstance(listed, list)
    chosen = capability["default_model_id"]
    found = next(
        (
            one
            for one in listed
            if isinstance(one, dict) and one["id"] == chosen
        ),
        None,
    )
    has_effort = found is not None and bool(found["efforts"])
    return chosen, capability["default_effort"] if has_effort else None


async def test_a_new_session_is_stamped_with_the_route_the_panel_shows(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    """建行时就把默认那一路盖上，不留 NULL。

    ⚠ 留 NULL 的话推进那一层退回按量计费，而面板显示的是能力端点报的默认
    （订阅登录过时就是订阅账号）——两边不一致时运行期一点迹象都没有，
    只有账单看得出来。所以这两处必须是同一份判定。
    """
    probed = await db_client.get(CAPABILITIES_URL)
    assert probed.status_code == 200
    profile, effort = _default_route(_data(probed))

    created = await _create(db_client, sign([ASSISTANT_USE]))

    assert created["model_profile"] == profile
    assert created["reasoning_effort"] == effort
