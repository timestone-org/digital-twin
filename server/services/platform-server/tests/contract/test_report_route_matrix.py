"""报告 API 自身的权限声明与边缘口径逐项一致。"""

from fastapi import FastAPI

from contract.test_route_matrix import iter_routes
from platform_server.apps.report.api import ROUTERS
from platform_server.deps import REQUIRED_CODES_ATTR


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


def test_report_routes_have_complete_permission_gates():
    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router)
    routes = list(iter_routes(app))
    assert len(routes) >= 18
    for route in routes:
        declared = set()
        pending = [route.dependant]
        while pending:
            dependency = pending.pop()
            declared.update(getattr(dependency.call, REQUIRED_CODES_ATTR, ()))
            pending.extend(dependency.dependencies)
        for method in route.methods:
            assert frozenset(declared) == expected(method, route.path), (
                method,
                route.path,
            )
