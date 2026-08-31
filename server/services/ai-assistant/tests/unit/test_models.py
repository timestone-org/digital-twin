"""表结构：模型与迁移必须描述同一件事。

⚠ 这一层守的是「改了模型忘了改迁移」：两边不一致时本地用例照常全绿
（用例走的是模型），只有对着真库跑的那一刻才炸，而那通常是在部署时。
"""

from ai_assistant.apps.chat.enums import (
    MESSAGE_ROLES,
    STEP_KINDS,
    STEP_STATES,
    SURFACE_KINDS,
    sql_values,
)
from ai_assistant.apps.chat.models import (
    Base,
    ChatMessage,
    ChatSession,
    ChatStep,
)
from ai_assistant.settings import DB_SCHEMA


def test_every_table_lives_in_the_services_own_schema() -> None:
    schemas = {table.schema for table in Base.metadata.tables.values()}
    assert schemas == {DB_SCHEMA}


def test_the_three_tables_are_registered() -> None:
    names = {table.name for table in Base.metadata.tables.values()}
    assert names == {"chat_sessions", "chat_messages", "chat_steps"}


def test_session_columns_match_the_migration() -> None:
    columns = {column.name for column in ChatSession.__table__.columns}
    assert columns == {
        "id",
        "user_id",
        "title",
        "surface_kind",
        "surface_ref",
        "model_profile",
        "reasoning_effort",
        "is_archived",
        "row_version",
        "last_error",
        "plan_json",
        "summary_json",
        "created_at",
        "updated_at",
    }


def test_message_columns_match_the_migration() -> None:
    columns = {column.name for column in ChatMessage.__table__.columns}
    assert columns == {
        "id",
        "session_id",
        "seq",
        "role",
        "content_json",
        "usage_json",
        "created_at",
        "updated_at",
    }


def test_step_columns_match_the_migration() -> None:
    columns = {column.name for column in ChatStep.__table__.columns}
    assert columns == {
        "id",
        "message_id",
        "seq",
        "kind",
        "name",
        "state",
        "input_json",
        "output_json",
        "error",
        "started_at",
        "ended_at",
        "created_at",
        "updated_at",
    }


def test_closed_sets_are_spelled_the_same_way_in_sql() -> None:
    # 闭合集合与 CHECK 约束里的字面量是同一份，改一处必须两处一起动
    assert sql_values(SURFACE_KINDS).count(",") == len(SURFACE_KINDS) - 1
    assert sql_values(MESSAGE_ROLES) == "'user', 'assistant', 'tool'"
    assert sql_values(STEP_KINDS) == "'model', 'server_tool', 'client_tool'"
    assert sql_values(STEP_STATES).startswith("'running'")


def test_the_waiting_state_exists_because_resume_may_land_elsewhere() -> None:
    # 待续状态必须能落库：api 角色无状态，续跑可能落到另一个副本上
    assert "awaiting_client" in STEP_STATES
