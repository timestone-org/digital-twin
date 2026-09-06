"""报告边缘规则覆盖真实 OpenAPI，下载权限高于普通读面。"""

import json
from pathlib import Path

import pytest

from auth_server.apps.auth.services.matching import find_rule
from contract.rule_views import catalog_rule_views

SPEC = (
    Path(__file__).resolve().parents[5]
    / "server/services/platform-server/openapi.json"
)
_METHODS = frozenset(("get", "post", "put", "patch", "delete"))


def cases():
    paths = json.loads(SPEC.read_text())["paths"]
    return [
        (method.upper(), path)
        for path, operations in paths.items()
        if path.startswith("/api/v1/platform/report-")
        for method in operations
        if method in _METHODS
    ]


def expected(method: str, path: str) -> frozenset[str]:
    if path.endswith("/files") or (
        method == "POST" and path.endswith("/report-renders")
    ):
        return frozenset(("report:render",))
    if method == "GET":
        return frozenset(("report:view",))
    if "/report-schedules" in path:
        return frozenset(("report:schedule",))
    return frozenset(("report:manage",))


@pytest.mark.parametrize(("method", "path"), cases())
def test_report_edge_permissions(method, path):
    rule = find_rule(catalog_rule_views(), path=path, method=method)
    assert rule is not None
    assert frozenset(rule.permission_codes) == expected(method, path)
