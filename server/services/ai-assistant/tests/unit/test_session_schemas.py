"""会话面那几件不连库就能钉住的契约。

入参的闭合集合与长度上限、归档语义、看得见谁的判定，以及列表排序键——最后一条
错了不会报错，只会让分页静默重复某一行并漏掉另一行。
"""

import uuid

import pytest
from pydantic import TypeAdapter, ValidationError

from ai_assistant.apps.chat.crud import DEFAULT_ORDER, session_crud
from ai_assistant.apps.chat.enums import SURFACE_KINDS
from ai_assistant.apps.chat.models.session import (
    SURFACE_REF_MAX_LENGTH,
    TITLE_MAX_LENGTH,
)
from ai_assistant.apps.chat.schemas import (
    SessionCreateIn,
    SessionOut,
    SessionUpdateIn,
)
from ai_assistant.apps.chat.schemas import session as session_schemas
from ai_assistant.apps.chat.services.session_service import visible_owner
from lib.auth import CallerContext
from lib.utils.timeutils import utcnow

ASSISTANT_USE = "assistant:use"


def _caller(*codes: str) -> CallerContext:
    return CallerContext(
        user_id=uuid.uuid4(),
        username="测试员",
        role="operator",
        permissions=frozenset(codes),
    )


@pytest.mark.parametrize("surface_kind", SURFACE_KINDS)
def test_every_registered_surface_kind_is_accepted(surface_kind: str) -> None:
    payload = SessionCreateIn(surface_kind=surface_kind)
    assert payload.surface_kind == surface_kind


def test_an_unregistered_surface_kind_is_rejected() -> None:
    with pytest.raises(ValidationError):
        SessionCreateIn(surface_kind="dashboard-editorr")


def test_the_surface_kinds_reach_the_generated_schema() -> None:
    schema = TypeAdapter(SessionCreateIn).json_schema()
    surface = schema["properties"]["surface_kind"]
    assert surface["enum"] == list(SURFACE_KINDS)


def test_a_create_payload_cannot_choose_its_owner() -> None:
    with pytest.raises(ValidationError):
        SessionCreateIn.model_validate(
            {"surface_kind": "twin-editor", "user_id": str(uuid.uuid4())}
        )


def test_a_title_wider_than_the_column_is_rejected() -> None:
    with pytest.raises(ValidationError):
        SessionCreateIn(
            surface_kind="twin-editor", title="题" * (TITLE_MAX_LENGTH + 1)
        )


def test_the_input_limits_match_the_column_widths() -> None:
    assert session_schemas.TITLE_MAX_LENGTH == TITLE_MAX_LENGTH
    assert session_schemas.SURFACE_REF_MAX_LENGTH == SURFACE_REF_MAX_LENGTH


def test_a_blank_title_is_allowed() -> None:
    payload = SessionCreateIn(surface_kind="twin-editor")
    assert payload.title == ""


@pytest.mark.parametrize("field", ["title", "is_archived"])
def test_an_explicit_null_on_a_non_nullable_field_is_rejected(
    field: str,
) -> None:
    with pytest.raises(ValidationError):
        SessionUpdateIn.model_validate({field: None})


def test_an_omitted_field_is_not_a_change() -> None:
    payload = SessionUpdateIn.model_validate({"is_archived": True})
    assert payload.model_dump(exclude_unset=True) == {"is_archived": True}


def test_an_empty_patch_carries_no_change() -> None:
    payload = SessionUpdateIn.model_validate({})
    assert payload.model_dump(exclude_unset=True) == {}


def test_the_list_order_ends_on_a_unique_column() -> None:
    rendered = [str(clause) for clause in DEFAULT_ORDER]
    assert rendered == [
        "assistant.chat_sessions.updated_at DESC",
        "assistant.chat_sessions.id ASC",
    ]


def test_a_plain_caller_only_sees_their_own_sessions() -> None:
    caller = _caller(ASSISTANT_USE)
    assert visible_owner(caller) == caller.user_id


def test_the_owner_lands_in_the_list_query() -> None:
    owner_id = uuid.uuid4()
    statement = session_crud.build_query(
        owner_id=owner_id, surface_kind=None, is_archived=None
    )
    assert "chat_sessions.user_id = " in str(statement)


def test_an_unlimited_owner_leaves_the_query_unfiltered() -> None:
    statement = session_crud.build_query(
        owner_id=None, surface_kind=None, is_archived=None
    )
    assert "WHERE" not in str(statement)


def test_both_filters_narrow_the_list_query() -> None:
    statement = session_crud.build_query(
        owner_id=None, surface_kind="dataset-table", is_archived=True
    )
    rendered = str(statement)
    assert "chat_sessions.surface_kind = " in rendered
    assert "chat_sessions.is_archived = true" in rendered


def test_timestamps_leave_as_utc_with_a_trailing_zulu() -> None:
    moment = utcnow()
    row = SessionOut(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        title="",
        surface_kind="twin-editor",
        surface_ref=None,
        is_archived=False,
        row_version=1,
        last_error=None,
        created_at=moment,
        updated_at=moment,
    )
    assert row.model_dump(mode="json")["created_at"].endswith("Z")
