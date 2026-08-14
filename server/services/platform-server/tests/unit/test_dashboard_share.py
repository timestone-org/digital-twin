"""发布面的三条口径：令牌每次换新、公开出参不带内部字段、形状不合就不打库。

⚠ 「公开出参不带内部字段」这条只能靠逐字断言键集合：出参模型多一个字段不会
报错，只会让公开链接开始外发项目 id 与创建时刻。
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from platform_server.apps.dashboard.models import (
    Dashboard,
    DashboardBinding,
    DashboardNode,
)
from platform_server.apps.dashboard.services import share_service

DASHBOARD_ID = uuid.UUID("0198f0c0-0000-7000-8000-0000000000c1")
PROJECT_ID = uuid.UUID("0198f0c0-0000-7000-8000-0000000000c2")
NODE_ID = uuid.UUID("0198f0c0-0000-7000-8000-0000000000c3")
BINDING_ID = uuid.UUID("0198f0c0-0000-7000-8000-0000000000c4")
MOMENT = datetime(2026, 8, 14, 9, 30, tzinfo=UTC)
# secrets.token_urlsafe(32) 的定长产物
TOKEN_CHARS = 43

PUBLIC_DASHBOARD_KEYS = frozenset(
    {
        "name",
        "description",
        "design_width",
        "design_height",
        "schema_version",
        "theme_json",
        "chrome_json",
        "updated_at",
        "nodes",
    }
)
PUBLIC_NODE_KEYS = frozenset(
    {
        "id",
        "parent_id",
        "client_key",
        "module_type",
        "x",
        "y",
        "w",
        "h",
        "z_index",
        "is_visible",
        "config_json",
        "bindings",
    }
)
PUBLIC_BINDING_KEYS = frozenset(
    {
        "id",
        "field_key",
        "source_kind",
        "node_key",
        "static_value_json",
        "compute_json",
        "detail_json",
        "transform_json",
    }
)


def make_dashboard() -> Dashboard:
    """一张不落库的大屏，字段逐个给全。"""
    return Dashboard(
        id=DASHBOARD_ID,
        project_id=PROJECT_ID,
        name="光伏总览",
        description="厂区总览",
        design_width=1920,
        design_height=1080,
        theme_json={"mode": "dark"},
        chrome_json={"header": True},
        row_version=7,
        schema_version=1,
        is_public=True,
        public_token="tok",
        created_at=MOMENT,
        updated_at=MOMENT,
    )


def make_node() -> DashboardNode:
    """一个不落库的画布节点。"""
    return DashboardNode(
        id=NODE_ID,
        dashboard_id=DASHBOARD_ID,
        parent_id=None,
        client_key="header-1",
        module_type="header",
        x_px=0,
        y_px=0,
        width_px=1920,
        height_px=96,
        z_index=3,
        is_visible=True,
        config_json={"title": "厂区"},
        created_at=MOMENT,
        updated_at=MOMENT,
    )


def make_binding() -> DashboardBinding:
    """一条不落库的绑定。"""
    return DashboardBinding(
        id=BINDING_ID,
        node_id=NODE_ID,
        field_key="value",
        source_kind="static",
        node_key=None,
        static_value_json=42,
        compute_json=None,
        detail_json=None,
        transform_json=None,
        created_at=MOMENT,
        updated_at=MOMENT,
    )


def dumped(model: Any) -> dict[str, Any]:
    """按对外口径序列化一份出参。

    Args: model。
    """
    payload: dict[str, Any] = model.model_dump(mode="json", by_alias=True)
    return payload


def test_every_publish_mints_a_brand_new_token() -> None:
    # 不换新的话「取消发布再发布」会让旧链接重新生效，撤回就是假的
    minted = {share_service.new_public_token() for _ in range(64)}
    assert len(minted) == 64


def test_the_token_is_url_safe_and_long_enough_to_be_unguessable() -> None:
    token = share_service.new_public_token()
    assert len(token) == TOKEN_CHARS
    assert set(token) <= set(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    )


def test_a_blank_or_oversized_token_never_reaches_the_database() -> None:
    assert not share_service.is_wellformed_token("")
    assert not share_service.is_wellformed_token(
        "x" * (share_service.MAX_TOKEN_CHARS + 1)
    )
    assert share_service.is_wellformed_token(share_service.new_public_token())


def test_the_public_dashboard_carries_only_the_render_fields() -> None:
    payload = dumped(
        share_service.to_public_dashboard_out(make_dashboard(), nodes=[])
    )
    assert set(payload) == PUBLIC_DASHBOARD_KEYS


def test_the_public_dashboard_hides_its_place_in_the_library() -> None:
    # 逐字钉住这四个：拿到公开链接的人不该知道这张屏在库里的位置与身世，
    # 也不该拿到乐观锁的计数器——「变没变」由 updated_at 回答
    payload = dumped(
        share_service.to_public_dashboard_out(make_dashboard(), nodes=[])
    )
    assert "id" not in payload
    assert "project_id" not in payload
    assert "created_at" not in payload
    assert "row_version" not in payload


def test_the_public_dashboard_never_echoes_the_token_back() -> None:
    # 出参里回令牌等于把它写进每一份前端缓存与每一条访问日志
    payload = dumped(
        share_service.to_public_dashboard_out(make_dashboard(), nodes=[])
    )
    assert "public_token" not in payload
    assert "is_public" not in payload


def test_the_public_node_keeps_the_geometry_aliases() -> None:
    payload = dumped(share_service.to_public_node_out(make_node(), bindings=[]))
    assert set(payload) == PUBLIC_NODE_KEYS
    assert (payload["x"], payload["y"], payload["w"], payload["h"]) == (
        0,
        0,
        1920,
        96,
    )


def test_the_public_node_drops_its_owning_dashboard_and_timestamps() -> None:
    payload = dumped(share_service.to_public_node_out(make_node(), bindings=[]))
    assert "dashboard_id" not in payload
    assert "created_at" not in payload
    assert "updated_at" not in payload


def test_the_public_binding_drops_its_owning_node_and_timestamps() -> None:
    payload = dumped(share_service.to_public_binding_out(make_binding()))
    assert set(payload) == PUBLIC_BINDING_KEYS


def test_bindings_ride_along_under_their_node() -> None:
    node = dumped(
        share_service.to_public_node_out(make_node(), bindings=[make_binding()])
    )
    assert [item["field_key"] for item in node["bindings"]] == ["value"]


def test_the_share_state_reports_the_freshly_minted_token() -> None:
    payload = dumped(share_service.to_share_out(make_dashboard()))
    assert payload == {
        "dashboard_id": str(DASHBOARD_ID),
        "is_public": True,
        "public_token": "tok",
        "updated_at": "2026-08-14T09:30:00.000Z",
    }


def test_the_share_state_of_a_withdrawn_dashboard_has_no_token() -> None:
    dashboard = make_dashboard()
    dashboard.is_public = False
    dashboard.public_token = None
    payload = dumped(share_service.to_share_out(dashboard))
    assert (payload["is_public"], payload["public_token"]) == (False, None)
