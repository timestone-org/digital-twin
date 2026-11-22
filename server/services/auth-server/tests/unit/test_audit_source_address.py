"""认证审计按已验证的网关来源或连接地址记账。"""

import pytest
from starlette.requests import Request

from auth_server.apps.auth.deps import _client_ip

_EDGE_KEY = "isolated-proxy-test"
_CONNECTION_IP = "192.0.2.17"


@pytest.mark.parametrize(
    ("address", "expected"),
    [
        ("198.51.100.9", "198.51.100.9"),
        ("2001:0db8:0:0::4", "2001:db8::4"),
        ("unavailable", _CONNECTION_IP),
    ],
)
def test_audit_address_comes_from_the_verified_edge(
    address: str, expected: str
) -> None:
    request = Request(
        {
            "type": "http",
            "client": (_CONNECTION_IP, 8100),
            "headers": [
                (b"x-edge-source-ip", address.encode()),
                (b"x-edge-audit-key", _EDGE_KEY.encode()),
            ],
        }
    )
    assert _client_ip(request, _EDGE_KEY) == expected


def test_direct_operation_keeps_its_connection_address() -> None:
    request = Request(
        {"type": "http", "client": (_CONNECTION_IP, 8100), "headers": []}
    )
    assert _client_ip(request, _EDGE_KEY) == _CONNECTION_IP


def test_source_metadata_without_edge_proof_keeps_the_connection_address() -> (
    None
):
    request = Request(
        {
            "type": "http",
            "client": (_CONNECTION_IP, 8100),
            "headers": [(b"x-edge-source-ip", b"198.51.100.9")],
        }
    )
    assert _client_ip(request, _EDGE_KEY) == _CONNECTION_IP
