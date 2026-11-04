"""定时训练与模板快捷创建的服务端权限矩阵。"""

from fastapi import FastAPI

from contract.test_route_matrix import gate_two_requirement, iter_routes
from platform_server.apps.modeling.api import (
    modeling_schedules,
    modeling_templates,
)


def test_schedule_and_template_workflow_routes_have_expected_permissions() -> (
    None
):
    app = FastAPI()
    app.include_router(modeling_schedules.router)
    app.include_router(modeling_templates.router)
    expected = {
        (
            "/api/v1/platform/modeling-pipelines/{pipeline_id}/schedule",
            "GET",
        ): "modeling:view",
        (
            "/api/v1/platform/modeling-pipelines/{pipeline_id}/schedule",
            "PUT",
        ): "modeling:run",
        (
            "/api/v1/platform/modeling-templates/{template_id}:create-workflow",
            "POST",
        ): "modeling:manage",
    }
    found = {}
    for route in iter_routes(app):
        for method in route.methods or set():
            key = (route.path, method)
            if key in expected:
                found[key] = gate_two_requirement(route)
    assert found == {
        key: (frozenset({value}), "all") for key, value in expected.items()
    }
