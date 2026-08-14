"""项目主题在 JSONB 数组里的读写口径。

⚠ 就地改数组是静默失败：JSONB 列上没有变更跟踪，`append` 之后 flush 一条
UPDATE 都不发，接口却照样回 200，用户以为主题存下了。
"""

import uuid

import pytest

from lib.utils.ids import uuid7
from platform_server.apps.dashboard.errors import ThemeNotFound
from platform_server.apps.dashboard.models import DashboardProject
from platform_server.apps.dashboard.schemas.theme import ThemeOut
from platform_server.apps.dashboard.services.theme_service import (
    decode_themes,
    index_of,
    store_themes,
)

TOKENS = {"surface": {"base": "#0b1220"}}


def theme(name: str = "夜航") -> ThemeOut:
    """造一套主题。

    Args: name。
    """
    return ThemeOut(id=uuid7(), name=name, mode="dark", tokens=TOKENS)


def project() -> DashboardProject:
    """造一个还没有自定义主题的项目，不挂会话。"""
    return DashboardProject(
        name="一期",
        description=None,
        theme_json={},
        brand_json={},
        custom_themes_json=[],
    )


def test_a_theme_survives_the_round_trip_through_jsonb() -> None:
    stored = project()
    original = theme()
    store_themes(stored, [original])
    assert decode_themes(stored.custom_themes_json) == [original]


def test_the_identifier_is_written_as_a_string() -> None:
    # JSONB 存不了 UUID 对象，`model_dump(mode="json")` 不能省
    stored = project()
    original = theme()
    store_themes(stored, [original])
    assert stored.custom_themes_json[0]["id"] == str(original.id)


def test_writing_back_replaces_the_whole_list_object() -> None:
    stored = project()
    before = stored.custom_themes_json
    store_themes(stored, [theme()])
    assert stored.custom_themes_json is not before


def test_an_empty_project_decodes_to_no_themes() -> None:
    assert decode_themes(project().custom_themes_json) == []


def test_the_stored_order_is_the_order_read_back() -> None:
    stored = project()
    ordered = [theme("甲"), theme("乙"), theme("丙")]
    store_themes(stored, ordered)
    names = [item.name for item in decode_themes(stored.custom_themes_json)]
    assert names == ["甲", "乙", "丙"]


def test_a_theme_is_found_by_its_identifier() -> None:
    themes = [theme("甲"), theme("乙")]
    assert index_of(themes, themes[1].id) == 1


def test_an_absent_theme_is_reported_as_not_found() -> None:
    with pytest.raises(ThemeNotFound):
        index_of([theme()], uuid.UUID(int=0))


def test_the_absent_theme_maps_to_not_found_status() -> None:
    assert ThemeNotFound.http_status == 404
