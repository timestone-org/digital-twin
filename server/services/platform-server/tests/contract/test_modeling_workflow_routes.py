"""工作流训练、发布和删除入口的权限契约。"""

from fastapi import FastAPI

from contract.test_route_matrix import gate_two_requirement, iter_routes
from platform_server.apps.modeling.api import modeling_pipelines, modeling_runs


def test_training_and_publication_routes_require_their_own_permissions() -> (
    None
):
    app = FastAPI()
    app.include_router(modeling_pipelines.router)
    app.include_router(modeling_runs.router)
    expected = {
        (
            "/api/v1/platform/modeling-pipelines/{pipeline_id}:run",
            "POST",
        ): "modeling:run",
        (
            "/api/v1/platform/modeling-runs/{run_id}:deploy",
            "POST",
        ): "modeling:publish",
        (
            "/api/v1/platform/modeling-runs/{run_id}",
            "DELETE",
        ): "modeling:publish",
    }
    actual = {
        (route.path, method): gate_two_requirement(route)
        for route in iter_routes(app)
        for method in route.methods or set()
        if (route.path, method) in expected
    }
    assert actual == {
        key: (frozenset({permission}), "all")
        for key, permission in expected.items()
    }
