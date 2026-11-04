"""建模检索词空白规范化与已发布输入范围兼容。"""

import pytest
from pydantic import TypeAdapter, ValidationError

from platform_server.apps.modeling.schemas.common import SearchText
from platform_server.apps.modeling.schemas.management import (
    BindingListQuery,
    DeploymentListQuery,
    ManagementListQuery,
    OptionalPageListQuery,
)


@pytest.mark.parametrize(
    ("given", "expected"),
    [("  Workflow  ", "Workflow"), ("  ", None), ("", None)],
)
def test_management_search_normalizes_optional_keywords(
    given: str, expected: str | None
) -> None:
    assert ManagementListQuery(q=given).q == expected


@pytest.mark.parametrize("model", [BindingListQuery, DeploymentListQuery])
@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({}, None),
        ({"page": 2}, (2, 20)),
        ({"size": 7}, (1, 7)),
        ({"page": 3, "size": 4}, (3, 4)),
    ],
)
def test_legacy_arrays_require_an_explicit_paging_parameter(
    model: type[OptionalPageListQuery],
    payload: dict[str, int],
    expected: tuple[int, int] | None,
) -> None:
    page = model.model_validate(payload).page_params
    if expected is None:
        assert page is None
    else:
        assert page is not None
        assert (page.page, page.size) == expected


@pytest.mark.parametrize(
    "model", [ManagementListQuery, BindingListQuery, DeploymentListQuery]
)
def test_bounded_search_validates_the_trimmed_word(
    model: type[ManagementListQuery] | type[OptionalPageListQuery],
) -> None:
    assert model(q="  " + "x" * 128 + "  ").q == "x" * 128
    with pytest.raises(ValidationError):
        model(q="x" * 129)


def test_legacy_bare_search_keeps_its_original_unbounded_length() -> None:
    assert TypeAdapter(SearchText).validate_python("x" * 256) == "x" * 256
