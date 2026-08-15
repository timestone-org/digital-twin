"""模板里那份整屏包存进去与读出来必须逐字同形，而列表项不许带上它。

⚠ 几何在包里叫 `x`/`y`/`w`/`h`：按字段名存下来的包读出去与 `:export` 的产出
对不上，而两边都不会报错——前端拿到的只是一份「少了坐标」的模板。
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from platform_server.apps.dashboard.models import DashboardTemplate
from platform_server.apps.dashboard.schemas.transfer import (
    DashboardExportOut,
    ExportBindingIn,
    ExportNodeIn,
)
from platform_server.apps.dashboard.services.template_service import (
    package_json,
    package_of,
    to_summary_out,
    to_template_out,
)

STAMP = datetime(2026, 8, 14, 3, 4, 5, tzinfo=UTC)


def document() -> DashboardExportOut:
    """造一份带一棵两层树的整屏包。"""
    return DashboardExportOut(
        schema_version=1,
        name="光伏总览",
        description="出处屏",
        design_width=1920,
        design_height=1080,
        theme_json={"mode": "dark"},
        chrome_json={},
        nodes=[
            ExportNodeIn(
                client_key="top",
                module_type="header",
                x_px=0,
                y_px=0,
                width_px=1920,
                height_px=96,
            ),
            ExportNodeIn(
                client_key="scene",
                parent_key="top",
                module_type="twin-view",
                x_px=10,
                y_px=20,
                width_px=400,
                height_px=300,
                bindings=[
                    ExportBindingIn(
                        field_key="anchorValues[0].value",
                        source_kind="static",
                        static_value_json="on",
                    )
                ],
            ),
        ],
    )


def template(
    *,
    payload_json: dict[str, Any] | None = None,
    thumbnail: str | None = None,
    category: str | None = "光伏",
) -> DashboardTemplate:
    """造一行已落库形态的模板。

    Args: payload_json, thumbnail, category。
    """
    return DashboardTemplate(
        id=uuid.uuid4(),
        name="光伏总览模板",
        description="模板自己的说明",
        category=category,
        thumbnail=thumbnail,
        payload_json=payload_json or package_json(document()),
        source_project_id=uuid.uuid4(),
        created_at=STAMP,
        updated_at=STAMP,
    )


def test_the_stored_package_names_geometry_the_way_the_export_does() -> None:
    stored = package_json(document())
    assert set(stored["nodes"][0]) >= {"x", "y", "w", "h"}


def test_the_stored_package_carries_no_python_side_field_names() -> None:
    stored = package_json(document())
    assert "x_px" not in stored["nodes"][0]


def test_a_package_read_back_out_is_the_one_that_went_in() -> None:
    original = document()
    assert package_of(template(payload_json=package_json(original))) == original


def test_reading_a_package_twice_gives_the_same_thing() -> None:
    row = template()
    assert package_of(row) == package_of(row)


def test_the_package_keeps_the_tree_and_its_bindings() -> None:
    package = package_of(template())
    assert [node.parent_key for node in package.nodes] == [None, "top"]
    assert [binding.field_key for binding in package.nodes[1].bindings] == [
        "anchorValues[0].value"
    ]


def test_a_summary_never_carries_the_package() -> None:
    # 一页 20 条整包就是十几 MB，而模板墙上根本用不到它
    assert "payload" not in to_summary_out(template()).model_dump()


def test_a_summary_carries_the_thumbnail_the_wall_renders() -> None:
    row = template(thumbnail="data:image/png;base64,AAA")
    assert to_summary_out(row).thumbnail == "data:image/png;base64,AAA"


def test_a_summary_reports_a_template_without_a_thumbnail_as_empty() -> None:
    assert to_summary_out(template()).thumbnail is None


def test_a_summary_carries_the_category_it_was_filed_under() -> None:
    assert to_summary_out(template()).category == "光伏"


def test_the_detail_carries_the_package() -> None:
    row = template()
    assert to_template_out(row).payload == package_of(row)


def test_the_detail_keeps_the_template_own_name_not_the_screen_one() -> None:
    # 包里那个名字是另存为那一刻源屏的名字，模板墙上认的是模板名
    detail = to_template_out(template())
    assert (detail.name, detail.payload.name) == ("光伏总览模板", "光伏总览")


def test_the_detail_reports_where_the_template_came_from() -> None:
    row = template()
    assert to_template_out(row).source_project_id == row.source_project_id
