"""模型调用统一使用账号鉴权，并保留边缘限流。"""

from pathlib import Path

from fastapi.routing import APIRoute

from platform_server.apps.modeling.api.open_models import open_models
from platform_server.deps import REQUIRED_CODES_ATTR

ROOT = Path(__file__).resolve().parents[5]


def test_every_model_call_requires_modeling_view() -> None:
    routes = [
        route for route in open_models.routes if isinstance(route, APIRoute)
    ]
    assert len(routes) == 4
    for route in routes:
        pending = list(route.dependant.dependencies)
        codes: set[str] = set()
        while pending:
            dependency = pending.pop()
            codes.update(getattr(dependency.call, REQUIRED_CODES_ATTR, ()))
            pending.extend(dependency.dependencies)
        assert codes == {"modeling:view"}, route.path


def test_all_edge_variants_authenticate_model_calls() -> None:
    for name in (
        "nginx.conf.template",
        "dt-edge.windows.conf",
    ):
        source = (ROOT / "docker/nginx" / name).read_text()
        block = source.split("location ^~ /api/v1/platform/open-models/ {", 1)[
            1
        ].split("}", 1)[0]
        assert "auth-inject.conf;" in block, name
        assert "limit_req zone=" in block, name
        assert "client_max_body_size 256k;" in block, name
