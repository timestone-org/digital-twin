"""线上口径的取值本身。

这里守的不是"两侧一致"——一致由两侧都 import 本包保证；守的是**取值不许被
顺手改掉**。这些字面量已经在跑着的 Redis 与库里，改一个就是改一份已上线的
契约，必须先改这份用例。
"""

from uuid import UUID

from collectwire import (
    ACTION_BROWSE,
    ACTION_BROWSE_SUBTREE,
    ACTION_READ,
    ACTION_VALIDATE,
    ACTION_WRITE,
    ACTIONS,
    ERROR_CATEGORIES,
    REPLY_PREFIX,
    REQUEST_KEY,
    SNAPSHOT_FIELDS,
    SNAPSHOT_KEY_PREFIX,
    STATE_COLUMNS,
    STATE_TABLE_NAME,
    STATE_UNKNOWN,
    STATES,
    STATUS_ERROR,
    STATUS_OK,
    TRACEPARENT_KEY,
    reply_key,
    snapshot_key,
)

SOURCE_ID = UUID("0192f000-0000-7000-8000-000000000001")
REQUEST_ID = "0192f111-0000-7000-8000-00000000000a"


def test_the_command_keys_are_the_ones_in_redis() -> None:
    assert REQUEST_KEY == "collect:cmd:req"
    assert REPLY_PREFIX == "collect:cmd:reply"
    assert reply_key(REQUEST_ID) == f"collect:cmd:reply:{REQUEST_ID}"


def test_the_snapshot_key_is_the_one_in_redis() -> None:
    assert SNAPSHOT_KEY_PREFIX == "collect:snapshot"
    assert snapshot_key(SOURCE_ID) == f"collect:snapshot:{SOURCE_ID}"


def test_the_snapshot_payload_carries_exactly_three_fields() -> None:
    """多一个字段读侧不认识，少一个读侧解不出读数。"""
    assert set(SNAPSHOT_FIELDS) == {"value", "ts_ms", "quality"}


def test_the_actions_are_stable_words_not_numbers() -> None:
    """禁数字枚举（api-contract §6）：数字动作在日志里没法读。"""
    assert ACTIONS == (
        ACTION_BROWSE,
        ACTION_BROWSE_SUBTREE,
        ACTION_READ,
        ACTION_WRITE,
        ACTION_VALIDATE,
    )
    assert set(ACTIONS) == {
        "browse",
        "browse_subtree",
        "read",
        "write",
        "validate",
    }


def test_browsing_a_layer_and_a_subtree_are_two_actions() -> None:
    """⚠ 两者的设备负载差着两个数量级，合成一个带开关的动作就没法分预算。"""
    assert ACTION_BROWSE != ACTION_BROWSE_SUBTREE


def test_success_and_failure_use_two_stable_status_words() -> None:
    assert (STATUS_OK, STATUS_ERROR) == ("ok", "error")


def test_the_envelope_key_for_the_trace_is_the_w3c_name() -> None:
    """⚠ 总线不会自动传播链路，漏了这一项链路就在异步处齐断。"""
    assert TRACEPARENT_KEY == "traceparent"


def test_the_state_table_name_carries_no_schema_prefix() -> None:
    """schema 名是各服务自己的配置，写进共享口径就绑死了部署形态。"""
    assert STATE_TABLE_NAME == "collect_source_states"
    assert "." not in STATE_TABLE_NAME


def test_the_state_columns_are_the_ones_in_the_migration() -> None:
    assert STATE_COLUMNS == (
        "source_id",
        "state",
        "point_count",
        "error_category",
        "error_detail",
        "leader_instance",
        "updated_at",
    )


def test_the_states_keep_the_check_constraint_order() -> None:
    """顺序即 CHECK 约束的字面量顺序，与初始迁移逐字一致。"""
    assert STATES == ("connecting", "online", "offline")


def test_the_unknown_state_is_not_one_of_the_stored_states() -> None:
    """⚠ 「没接手过」与「接手了但连不上」处置不同，不许合成一档。"""
    assert STATE_UNKNOWN not in STATES


def test_the_error_categories_are_the_ones_in_the_check_constraint() -> None:
    assert ERROR_CATEGORIES == ("transient", "config", "auth")
