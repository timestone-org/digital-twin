"""HTTP 身份头大小写不影响转发，身份值与允许字段保持不变。"""

import pytest

from knowledge_server.apps.knowledge.services.identity import caller_headers


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
