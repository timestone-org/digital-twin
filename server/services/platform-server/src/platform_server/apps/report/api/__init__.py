"""报告路由集合。"""

from platform_server.apps.report.api.imports import router as imports
from platform_server.apps.report.api.renders import router as renders
from platform_server.apps.report.api.schedules import router as schedules
from platform_server.apps.report.api.templates import router as templates

ROUTERS = (templates, renders, schedules, imports)
