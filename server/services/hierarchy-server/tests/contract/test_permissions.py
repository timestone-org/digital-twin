"""层级图三道闸的路由与权限目录契约。"""

import re
from fnmatch import fnmatchcase

from fastapi.routing import APIRoute

from auth_server.apps.auth.catalog import ALL_CODES, ROUTE_RULES
from hierarchy_server.apps.projects.api.projects import router
from lib.web.authdeps import REQUIRED_CODES_ATTR


def test_every_business_endpoint_matches_auth_catalog():
    routes = [route for route in router.routes if isinstance(route, APIRoute)]
    assert len(routes) == 8
    for route in routes:
        path = re.sub(
            r"\{[^}]+\}", "10000000-0000-0000-0000-000000000001", route.path
        )
        pending = list(route.dependant.dependencies)
        required = set()
        while pending:
            dependency = pending.pop()
            required.update(getattr(dependency.call, REQUIRED_CODES_ATTR, ()))
            pending.extend(dependency.dependencies)
        assert required
        assert required <= ALL_CODES
        for method in route.methods:
            matches = [
                rule
                for rule in ROUTE_RULES
                if rule.http_method in (method, "*")
                and fnmatchcase(path, rule.path_pattern)
            ]
            assert matches
            assert required == set(
                max(matches, key=lambda rule: rule.priority).codes
            )
