"""目录按分类、分区读取，规则完整且条目可翻至末页。"""

import pytest

from ai_assistant.apps.chat.services.tools.catalog.formulas import catalog_of
from ai_assistant.apps.chat.services.tools.catalog.modules import (
    catalog_of as modules_of,
)
from ai_assistant.apps.chat.services.tools.pagination import ToolPage
from ai_assistant.apps.chat.services.tools.specs import spec_of


def test_formula_sections_are_separate_and_library_strings_survive() -> None:
    body = {
        "functions": [{"name": "SUM"}],
        "columns": [{"key": "T"}],
        "library": ["同比", "环比"],
        "rules": ["空值跳过"],
    }
    first = catalog_of(body, None)
    assert "columns" not in first
    assert "library" not in first
    library = catalog_of(
        body, None, {"section": "library", "limit": 1, "page": 2}
    )
    assert library["library"] == ["环比"]
    assert library["rules"] == ["空值跳过"]
    assert library["has_more"] is False
    assert library["next_page"] is None


def test_formula_filters_and_paginates_functions() -> None:
    body = {
        "functions": [
            {"name": str(index), "category": "math"} for index in range(25)
        ]
    }
    first = catalog_of(body, None, {"category": "math"})
    assert len(first["functions"]) == 20
    assert first["next_page"] == 2
    last = catalog_of(body, None, {"category": "math", "page": 2})
    assert [one["name"] for one in last["functions"]] == [
        "20",
        "21",
        "22",
        "23",
        "24",
    ]
    assert last["has_more"] is False
    assert catalog_of(body, None, {"category": "none"})["total"] == 0


def test_unknown_formula_section_is_rejected() -> None:
    with pytest.raises(ValueError, match="section"):
        catalog_of({}, None, {"section": "all"})


def test_modules_filter_category_before_pagination() -> None:
    body = {
        "modules": [
            {"type": str(index), "category": "data"} for index in range(25)
        ]
    }
    first = modules_of(body, None, {"category": "data"})
    assert len(first["modules"]) == 20
    last = modules_of(
        body, None, {"category": "data", "page": first["next_page"]}
    )
    assert [one["type"] for one in last["modules"]] == [
        "20",
        "21",
        "22",
        "23",
        "24",
    ]
    assert last["has_more"] is False
    assert modules_of(body, None, {"category": "none"})["total"] == 0


def test_empty_and_out_of_range_pages_end() -> None:
    assert ToolPage().select([]) == []
    assert ToolPage(page=3).select([1, 2]) == []
    assert ToolPage(page=3).describe(2)["next_page"] is None


@pytest.mark.parametrize(
    "name",
    [
        "modules.catalog",
        "formula.catalog",
        "points.list_sources",
        "dashboards.list",
        "datasets.list_tables",
        "datasets.read_columns",
        "assets.search",
        "knowledge.list_bases",
        "twin.list_folders",
        "twin.list_entities",
    ],
)
def test_list_tool_declares_bounded_pagination(name: str) -> None:
    spec = spec_of(name)
    assert spec is not None
    properties = spec.parameters["properties"]
    assert properties["page"]["minimum"] == 1
    assert properties["limit"]["maximum"] == 20
