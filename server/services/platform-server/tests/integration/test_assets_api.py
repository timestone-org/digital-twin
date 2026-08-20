"""素材面的三步：签凭证 → 直传 → 确认落库，外加浏览、搜索、改名与删除。

⚠ 这条链上有三处「不报错但错」：finalize 从请求体收 kind（字节会被搬到错误
前缀，文件在但按 id 找不到）、元信息信调用方自报（界面显示的体积与文件无关）、
删素材先删行后删字节（留下一堆没有任何一行指向、也再没人清理的对象）。
"""

import uuid
from typing import Any

import httpx
import pytest

from lib.testing import FakeObjectStore
from platform_server.apps.assets import keys

pytestmark = pytest.mark.requires_postgres

ASSETS_URL = "/api/v1/platform/assets"
HTTP_CREATED = 201
HTTP_NO_CONTENT = 204
HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409

GLB = "model/gltf-binary"
BYTES = b"glTF-ish bytes"


def data_of(response: httpx.Response) -> Any:
    """取信封里的 data。"""
    return response.json()["data"]


def code_of(response: httpx.Response) -> int:
    """取信封里的错误码。"""
    return int(response.json()["code"])


async def presign(
    client: httpx.AsyncClient,
    *,
    kind: str = "model",
    content_type: str = GLB,
    size_bytes: int = 64,
) -> httpx.Response:
    """申请一张直传凭证。"""
    return await client.post(
        f"{ASSETS_URL}:presign-upload",
        json={
            "kind": kind,
            "content_type": content_type,
            "size_bytes": size_bytes,
        },
    )


async def upload(
    store: FakeObjectStore, key: str, *, content_type: str = GLB
) -> None:
    """替浏览器把字节放进暂存区。"""
    await store.put_bytes(key, BYTES, content_type=content_type)


async def make_asset(
    client: httpx.AsyncClient, store: FakeObjectStore, *, name: str = "机组"
) -> dict[str, Any]:
    """走完整三步，回落库后的素材。"""
    ticket = data_of(await presign(client))
    asset_id = ticket["asset_id"]
    await upload(store, keys.staging_key("model", _uuid(asset_id)))
    done = await client.post(
        f"{ASSETS_URL}/{asset_id}:finalize", json={"name": name}
    )
    return data_of(done)


def _uuid(text: str) -> uuid.UUID:
    """把响应里的 id 串还原成 UUID。"""
    return uuid.UUID(text)


async def test_the_ticket_is_created_without_writing_a_row(
    app_client: httpx.AsyncClient,
) -> None:
    response = await presign(app_client)
    asset_id = data_of(response)["asset_id"]

    assert response.status_code == HTTP_CREATED
    # 没传成的素材不许在库里留下半条记录
    missing = await app_client.get(f"{ASSETS_URL}/{asset_id}")
    assert missing.status_code == HTTP_NOT_FOUND


async def test_an_unknown_kind_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await presign(app_client, kind="video")
    assert (response.status_code, code_of(response)) == (
        HTTP_BAD_REQUEST,
        41501,
    )


async def test_a_type_outside_the_whitelist_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await presign(app_client, content_type="text/html")
    assert (response.status_code, code_of(response)) == (
        HTTP_BAD_REQUEST,
        41502,
    )


async def test_finalizing_without_the_bytes_says_so(
    app_client: httpx.AsyncClient,
) -> None:
    ticket = data_of(await presign(app_client))
    response = await app_client.post(
        f"{ASSETS_URL}/{ticket['asset_id']}:finalize", json={"name": "机组"}
    )

    # ⚠ 与「素材不存在」分开：这一条的处置是重传，那一条是换 id
    assert (response.status_code, code_of(response)) == (HTTP_CONFLICT, 41505)


async def test_finalizing_moves_the_bytes_out_of_staging(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    asset = await make_asset(app_client, object_store)
    asset_id = _uuid(asset["id"])

    assert await object_store.list_prefix("staging/") == []
    assert await object_store.get_bytes(keys.model_key(asset_id)) == BYTES


async def test_the_stored_size_comes_from_the_store_not_the_caller(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    # 申请时报了 64 字节，实际传上去的是另一个长度：落库的必须是后者
    asset = await make_asset(app_client, object_store)
    assert asset["size_bytes"] == len(BYTES)


async def test_the_reference_is_the_only_shape_that_lands(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    asset = await make_asset(app_client, object_store)
    # 存 URL 的话，部署地址一换存量配置就 404，而没有任何一处会报错
    assert asset["ref"] == f"asset:{asset['id']}"


async def test_finalizing_twice_returns_the_same_asset(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    asset = await make_asset(app_client, object_store)
    again = await app_client.post(
        f"{ASSETS_URL}/{asset['id']}:finalize", json={"name": "改个名"}
    )

    # 真幂等：重复确认既不报错也不产生第二个素材，名字也不被后一次改掉
    assert data_of(again) == asset


async def test_the_kind_comes_from_the_key_not_the_request(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    # 凭证按 icon 签发，字节也传在 icon 的暂存位上；请求体里没有 kind 可写错
    ticket = data_of(
        await presign(
            app_client, kind="icon", content_type="image/png", size_bytes=64
        )
    )
    asset_id = _uuid(ticket["asset_id"])
    await upload(
        object_store,
        keys.staging_key("icon", asset_id),
        content_type="image/png",
    )
    done = await app_client.post(
        f"{ASSETS_URL}/{ticket['asset_id']}:finalize", json={"name": "阀门"}
    )

    assert data_of(done)["kind"] == "icon"
    assert await object_store.stat(keys.icon_key(asset_id)) is not None


async def test_the_listing_filters_by_kind(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    await make_asset(app_client, object_store, name="机组")

    models = data_of(await app_client.get(ASSETS_URL, params={"kind": "model"}))
    icons = data_of(await app_client.get(ASSETS_URL, params={"kind": "icon"}))

    assert [item["name"] for item in models] == ["机组"]
    assert icons == []


async def test_listing_an_unknown_kind_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(ASSETS_URL, params={"kind": "video"})
    assert (response.status_code, code_of(response)) == (
        HTTP_BAD_REQUEST,
        41501,
    )


async def test_the_kind_catalog_carries_the_limits(
    app_client: httpx.AsyncClient,
) -> None:
    catalog = data_of(await app_client.get(f"{ASSETS_URL}/kinds"))
    model = next(item for item in catalog if item["kind"] == "model")

    # 上限随目录下发，界面不自己写一份——两份会漂，而漂了只表现为上传失败
    assert model["max_bytes"] > 0
    assert GLB in model["content_types"]


async def test_deleting_takes_the_bytes_with_it(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    asset = await make_asset(app_client, object_store)

    response = await app_client.delete(f"{ASSETS_URL}/{asset['id']}")

    assert response.status_code == HTTP_NO_CONTENT
    assert await object_store.list_prefix("models/") == []
    gone = await app_client.get(f"{ASSETS_URL}/{asset['id']}")
    assert gone.status_code == HTTP_NOT_FOUND


async def test_deleting_a_missing_asset_is_still_no_content(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.delete(
        f"{ASSETS_URL}/0192f0aa-0000-7000-8000-0000000000ff"
    )
    assert response.status_code == HTTP_NO_CONTENT


async def test_renaming_changes_only_the_display_name(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    asset = await make_asset(app_client, object_store, name="机组")

    renamed = data_of(
        await app_client.patch(
            f"{ASSETS_URL}/{asset['id']}", json={"name": "一号机组"}
        )
    )

    # ⚠ 改名是纯元信息操作：引用、对象键与校验和都不许跟着变，否则存量大屏里
    # 那条 `asset:<uuid>` 会在改名那一刻取不到，而没有任何一处会报错
    assert renamed["name"] == "一号机组"
    assert renamed["ref"] == asset["ref"]
    assert renamed["checksum"] == asset["checksum"]
    key = keys.model_key(_uuid(asset["id"]))
    assert await object_store.stat(key) is not None


async def test_renaming_a_missing_asset_is_a_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.patch(
        f"{ASSETS_URL}/0192f0aa-0000-7000-8000-0000000000ff",
        json={"name": "谁"},
    )
    assert (response.status_code, code_of(response)) == (HTTP_NOT_FOUND, 41504)


async def test_an_empty_name_is_refused(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    asset = await make_asset(app_client, object_store)

    # ⚠ 全空白也要被拒：`AssetName` 先 strip 再判长度，放过去的话列表里会出现
    # 一行点不中、也搜不到的素材
    # ⚠ 本仓的参数校验失败是 400/40001 而不是 FastAPI 缺省的 422
    response = await app_client.patch(
        f"{ASSETS_URL}/{asset['id']}", json={"name": "   "}
    )
    assert (response.status_code, code_of(response)) == (
        HTTP_BAD_REQUEST,
        40001,
    )


async def test_the_listing_filters_by_name_keyword(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    await make_asset(app_client, object_store, name="一号机组")
    await make_asset(app_client, object_store, name="二号泵")

    hits = data_of(await app_client.get(ASSETS_URL, params={"q": "机组"}))

    assert [item["name"] for item in hits] == ["一号机组"]


async def test_the_keyword_ignores_case(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    await make_asset(app_client, object_store, name="Pump.GLB")

    hits = data_of(await app_client.get(ASSETS_URL, params={"q": "glb"}))

    assert [item["name"] for item in hits] == ["Pump.GLB"]


async def test_like_wildcards_in_the_keyword_are_literal(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    await make_asset(app_client, object_store, name="负荷 50% 工况")
    await make_asset(app_client, object_store, name="别的东西")

    # ⚠ 不转义的话 `%` 是通配符，这一搜会把整库列出来，而现象只是「搜索没生效」
    hits = data_of(await app_client.get(ASSETS_URL, params={"q": "50%"}))

    assert [item["name"] for item in hits] == ["负荷 50% 工况"]


async def test_a_blank_keyword_means_no_filter(
    app_client: httpx.AsyncClient, object_store: FakeObjectStore
) -> None:
    await make_asset(app_client, object_store, name="机组")

    # 输入框清空后回传的是空串，它与「没传」是同一个意思
    hits = data_of(await app_client.get(ASSETS_URL, params={"q": "  "}))

    assert [item["name"] for item in hits] == ["机组"]
