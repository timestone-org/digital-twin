"""工作流训练、定时和发布入口在边缘采用各自操作权限。"""

import pytest

from auth_server.apps.auth.services.matching import find_rule
from contract.rule_views import catalog_rule_views

PREFIX = "/api/v1/platform"


@pytest.mark.parametrize(
    ("method", "suffix", "code"),
    [
        ("POST", "/modeling-pipelines/workflow:run", "modeling:run"),
        ("PUT", "/modeling-pipelines/workflow/schedule", "modeling:run"),
        ("GET", "/modeling-pipelines/workflow/schedule", "modeling:view"),
        ("POST", "/modeling-runs/run:deploy", "modeling:publish"),
        ("DELETE", "/modeling-runs/run", "modeling:publish"),
        (
            "POST",
            "/modeling-templates/template:create-workflow",
            "modeling:manage",
        ),
        ("GET", "/modeling-runs/run", "modeling:view"),
        ("POST", "/modeling-runs/run:cancel", "modeling:run"),
    ],
)
def test_workflow_operation_permissions(method: str, suffix: str, code: str):
    rule = find_rule(catalog_rule_views(), path=PREFIX + suffix, method=method)
    assert rule is not None
    assert rule.permission_codes == frozenset((code,))
