"""锁住五条授权不变式。

没有它们，「某个角色不含 X」只是种子的默认值而不是安全属性：
持 role:manage + user:grant 的账号三步即可自升全权。
"""

import uuid

import pytest

from auth_server.apps.auth.errors import (
    BuiltinImmutable,
    GrantExceedsOperator,
    SelfLockout,
    TargetHigherPrivileged,
)
from auth_server.apps.auth.services import guards

BUILTIN = frozenset({"a", "b", "c"})
OPERATOR = uuid.UUID("00000000-0000-4000-8000-000000000001")
TARGET = uuid.UUID("00000000-0000-4000-8000-000000000002")


def test_holder_of_every_builtin_code_is_super_admin() -> None:
    assert guards.is_super_admin(BUILTIN, BUILTIN)
    assert guards.is_super_admin(BUILTIN | {"custom"}, BUILTIN)


def test_missing_one_builtin_code_is_not_super_admin() -> None:
    assert not guards.is_super_admin(frozenset({"a", "b"}), BUILTIN)


def test_empty_builtin_baseline_never_yields_super_admin() -> None:
    assert not guards.is_super_admin(frozenset({"a"}), frozenset())


def test_cannot_grant_codes_the_operator_lacks() -> None:
    with pytest.raises(GrantExceedsOperator) as caught:
        guards.assert_grantable(
            operator_codes=frozenset({"a"}),
            granted_codes=frozenset({"a", "b"}),
            is_super=False,
        )
    assert "b" in str(caught.value)


def test_super_admin_may_grant_anything() -> None:
    guards.assert_grantable(
        operator_codes=frozenset(),
        granted_codes=frozenset({"z"}),
        is_super=True,
    )


def test_cannot_touch_a_more_privileged_target() -> None:
    with pytest.raises(TargetHigherPrivileged):
        guards.assert_target_not_higher(
            operator_codes=frozenset({"a"}),
            target_codes=frozenset({"a", "b"}),
            is_super=False,
            action="重置密码",
        )


def test_may_touch_an_equally_or_less_privileged_target() -> None:
    guards.assert_target_not_higher(
        operator_codes=frozenset({"a", "b"}),
        target_codes=frozenset({"a"}),
        is_super=False,
        action="修改",
    )


def test_cannot_edit_a_role_whose_current_codes_exceed_the_operator() -> None:
    with pytest.raises(TargetHigherPrivileged):
        guards.assert_role_not_higher(
            operator_codes=frozenset({"a"}),
            role_codes=frozenset({"a", "b"}),
            is_super=False,
        )


def test_builtin_role_name_and_codes_are_immutable() -> None:
    with pytest.raises(BuiltinImmutable):
        guards.assert_builtin_role_mutable(
            is_builtin=True, changing_name=True, changing_codes=False
        )
    with pytest.raises(BuiltinImmutable):
        guards.assert_builtin_role_mutable(
            is_builtin=True, changing_name=False, changing_codes=True
        )


def test_builtin_role_description_stays_editable() -> None:
    guards.assert_builtin_role_mutable(
        is_builtin=True, changing_name=False, changing_codes=False
    )


def test_custom_role_is_fully_mutable() -> None:
    guards.assert_builtin_role_mutable(
        is_builtin=False, changing_name=True, changing_codes=True
    )


def test_cannot_act_on_self() -> None:
    with pytest.raises(SelfLockout):
        guards.assert_not_self(
            operator_id=OPERATOR, target_id=OPERATOR, action="执行删除"
        )


def test_last_super_admin_is_protected() -> None:
    with pytest.raises(SelfLockout):
        guards.assert_not_last_super_admin(
            target_is_super=True, super_admin_count=1, action="删除"
        )


def test_non_super_target_is_not_protected_by_the_last_admin_rule() -> None:
    guards.assert_not_last_super_admin(
        target_is_super=False, super_admin_count=1, action="删除"
    )


def test_dropping_own_management_codes_is_refused() -> None:
    with pytest.raises(SelfLockout):
        guards.assert_keeps_admin_capability(
            operator_id=OPERATOR,
            target_id=OPERATOR,
            remaining_codes=frozenset(),
            required_codes=frozenset({"user:grant"}),
        )


def test_dropping_someone_elses_codes_is_allowed() -> None:
    guards.assert_keeps_admin_capability(
        operator_id=OPERATOR,
        target_id=TARGET,
        remaining_codes=frozenset(),
        required_codes=frozenset({"user:grant"}),
    )
