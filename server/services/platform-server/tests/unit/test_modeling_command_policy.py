"""命令作用域、请求指纹与可信外部操作者边界。"""

import uuid

import pytest

from lib.auth import CallerContext
from lib.errors import PermissionDenied, ValidationFailed
from platform_server.apps.modeling.services.command_policy import (
    choose_operation,
    fingerprint,
    hash_key,
    parse_scope,
)
from platform_server.apps.modeling.services.operator_audit import (
    resolve_operator,
)

ACCOUNT = uuid.UUID("0192f0c0-0000-7000-8000-000000000011")
RESOURCE = uuid.UUID("0192f0c0-0000-7000-8000-000000000012")


def test_json_order_does_not_change_request_fingerprint():
    original = fingerprint("POST", "/models", b'{"a":1,"b":2}', None)
    reordered = fingerprint("POST", "/models", b'{ "b":2, "a":1 }', None)
    changed = fingerprint("POST", "/models", b'{"a":2,"b":2}', None)
    assert original == reordered
    assert original != changed


@pytest.mark.parametrize("part", ["method", "path", "operator"])
def test_request_identity_fields_change_fingerprint(part):
    original = fingerprint("POST", "/models", b"{}", None)
    candidate = fingerprint(
        "PUT" if part == "method" else "POST",
        "/other-models" if part == "path" else "/models",
        b"{}",
        "external-user" if part == "operator" else None,
    )
    assert original != candidate


@pytest.mark.parametrize("key", ["", "a" * 257, "非ASCII", "new\nline"])
def test_invalid_idempotency_key_is_rejected(key):
    with pytest.raises(ValidationFailed):
        hash_key(key)


@pytest.mark.parametrize("body", [b"bad json", b'{"value":NaN}', b"\xff"])
def test_invalid_json_is_rejected_before_reservation(body):
    with pytest.raises(ValidationFailed):
        fingerprint("POST", "/models", body, None)


@pytest.mark.parametrize(
    ("name", "resource"),
    [("create_instance", RESOURCE), ("train_instance", None)],
)
def test_operation_requires_matching_resource_scope(name, resource):
    with pytest.raises(ValidationFailed):
        choose_operation(name, resource)


@pytest.mark.parametrize(
    "scope",
    [
        "other.create_instance",
        "modeling.not_real",
        "modeling.train_instance.bad",
    ],
)
def test_unknown_operation_scope_is_rejected(scope):
    with pytest.raises(ValidationFailed):
        parse_scope(scope)


def test_operation_recovers_resource_and_required_permission():
    operation = parse_scope(f"modeling.train_instance.{RESOURCE}")
    assert operation.resource_id == RESOURCE
    assert operation.permission == "modeling:run"
    assert operation.http_status == 202
    assert operation.scope == f"modeling.train_instance.{RESOURCE}"
    assert (
        choose_operation("create_deployment", None).permission
        == "modeling:publish"
    )
    assert choose_operation("create_instance", None).http_status == 201


def test_trusted_operator_is_separate_from_platform_account():
    caller = CallerContext(ACCOUNT, "gateway", "partner")
    identity = resolve_operator(caller, "bdm-user-7", (ACCOUNT,), "127.0.0.1")
    assert identity.account_user_id == ACCOUNT
    assert identity.external_operator_id == "bdm-user-7"


def test_untrusted_account_cannot_assert_external_identity():
    caller = CallerContext(ACCOUNT, "regular", "partner")
    with pytest.raises(PermissionDenied):
        resolve_operator(caller, "bdm-user-7", (), None)


@pytest.mark.parametrize("operator", ["", "with spaces", "a" * 129, "操作员"])
def test_trusted_gateway_still_needs_valid_operator_identifier(operator):
    caller = CallerContext(ACCOUNT, "gateway", "partner")
    with pytest.raises(ValidationFailed):
        resolve_operator(caller, operator, (ACCOUNT,), None)


def test_account_without_external_assertion_needs_no_gateway_trust():
    caller = CallerContext(ACCOUNT, "regular", "partner")
    identity = resolve_operator(caller, None, (), None)
    assert identity.external_operator_id is None
