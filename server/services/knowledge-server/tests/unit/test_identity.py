"""HTTP 身份头大小写不影响转发，身份值与允许字段保持不变。"""

import pytest

from knowledge_server.apps.knowledge.services.identity import caller_headers
from lib.auth import (
    SignedContext,
    encode_identity,
    encode_permissions,
    sign_context,
    sign_named_context,
)


@pytest.mark.parametrize("name", ["X-Auth-Role", "x-auth-role", "X-AUTH-ROLE"])
def test_http_header_name_is_case_insensitive(name: str) -> None:
    assert caller_headers({name: "%E6%93%8D%E4%BD%9C%E5%91%98"}) == {
        "X-Auth-Role": "%E6%93%8D%E4%BD%9C%E5%91%98"
    }


def test_unrelated_credentials_and_empty_headers_are_not_forwarded() -> None:
    assert (
        caller_headers(
            {
                "Authorization": "Bearer synthetic",
                "X-Service-Key": "synthetic",
                "x-auth-role": "",
                "traceparent": "synthetic",
            }
        )
        == {}
    )


def test_forwarding_preserves_the_signed_account_name() -> None:
    claims = SignedContext(
        "00000000-0000-7000-8000-000000000001",
        "reader",
        encode_permissions([]),
        1999999999,
    )
    username = encode_identity("本地读者")
    signed = {
        "X-Auth-User-Id": claims.user_id,
        "X-Auth-Username": username,
        "X-Auth-Role": claims.role,
        "X-Auth-Permissions": claims.permissions_b64,
        "X-Auth-Exp": str(claims.expires_at),
        "X-Auth-Sig": sign_context("local-identity", claims),
        "X-Auth-Sig-V2": sign_named_context("local-identity", claims, username),
    }
    assert caller_headers(signed) == signed
