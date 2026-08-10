"""锁住入参校验的拒绝路径。

⚠ 最关键的一条：注册与改自己资料的 schema 里**不存在** role/permission 字段，
配合 `extra="forbid"` 让「注册时把自己设成管理员」在 schema 层就不成立。
"""

import pytest
from pydantic import ValidationError

from auth_server.apps.auth.schemas import (
    LoginIn,
    MeUpdateIn,
    RegistrationIn,
    RouteRuleCreateIn,
    UserCreateIn,
)


def test_registration_rejects_privileged_fields() -> None:
    with pytest.raises(ValidationError):
        RegistrationIn(
            username="newbie",
            email="n@example.com",
            password="Passw0rd12",
            role_id="00000000-0000-4000-8000-000000000001",
        )


def test_self_profile_update_rejects_privileged_fields() -> None:
    for field in ("role_id", "is_active", "permissions"):
        with pytest.raises(ValidationError):
            MeUpdateIn(**{field: "x"})


@pytest.mark.parametrize(
    "password",
    ["short1", "alllettersonly", "1234567890", "  Pw1  "],
    ids=["too-short", "no-digit", "no-letter", "whitespace-padded-short"],
)
def test_weak_passwords_are_rejected(password: str) -> None:
    with pytest.raises(ValidationError):
        RegistrationIn(
            username="newbie", email="n@example.com", password=password
        )


def test_password_is_not_silently_trimmed() -> None:
    payload = RegistrationIn(
        username="newbie",
        email="n@example.com",
        password=" Passw0rd12345 ",
    )
    assert payload.password == " Passw0rd12345 "


@pytest.mark.parametrize(
    "username",
    ["ab", "_leading", "has space", "x" * 65, "汉字"],
    ids=["too-short", "bad-first-char", "space", "too-long", "non-ascii"],
)
def test_invalid_usernames_are_rejected(username: str) -> None:
    with pytest.raises(ValidationError):
        RegistrationIn(
            username=username, email="n@example.com", password="Passw0rd12"
        )


def test_malformed_email_is_rejected() -> None:
    with pytest.raises(ValidationError):
        UserCreateIn(
            username="newbie",
            email="not-an-email",
            password="Passw0rd12",
            role_id="00000000-0000-4000-8000-000000000001",
        )


def test_login_requires_non_empty_credentials() -> None:
    with pytest.raises(ValidationError):
        LoginIn(username="", password="")


def test_route_rule_pattern_must_be_absolute() -> None:
    with pytest.raises(ValidationError):
        RouteRuleCreateIn(path_pattern="api/v1/x", http_method="GET")


def test_route_rule_method_is_a_string_literal_not_a_number() -> None:
    with pytest.raises(ValidationError):
        RouteRuleCreateIn(path_pattern="/api/v1/x", http_method=1)


def test_route_rule_priority_is_bounded() -> None:
    with pytest.raises(ValidationError):
        RouteRuleCreateIn(
            path_pattern="/api/v1/x", http_method="GET", priority=1000
        )
