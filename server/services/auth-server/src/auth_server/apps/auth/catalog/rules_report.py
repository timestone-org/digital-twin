"""报告闸一权限，下载优先于 GET 读面。"""

from auth_server.apps.auth.catalog.permissions import (
    REPORT_MANAGE,
    REPORT_RENDER,
    REPORT_SCHEDULE,
    REPORT_VIEW,
)
from auth_server.apps.auth.catalog.specs import RouteRuleSpec

_PREFIX = "/api/v1/platform"
REPORT_RULES = (
    RouteRuleSpec(
        f"{_PREFIX}/report-*",
        "*",
        codes=(REPORT_MANAGE,),
        priority=1100,
        description="报告写兜底",
    ),
    RouteRuleSpec(
        f"{_PREFIX}/report-schedules*",
        "*",
        codes=(REPORT_SCHEDULE,),
        priority=1102,
        description="管理定时规则",
    ),
    RouteRuleSpec(
        f"{_PREFIX}/report-renders",
        "POST",
        codes=(REPORT_RENDER,),
        priority=1102,
        description="生成报告",
    ),
    RouteRuleSpec(
        f"{_PREFIX}/report-*",
        "GET",
        codes=(REPORT_VIEW,),
        priority=1104,
        description="报告读面",
    ),
    RouteRuleSpec(
        f"{_PREFIX}/report-renders/*/files",
        "GET",
        codes=(REPORT_RENDER,),
        priority=1106,
        description="下载含台账数据的报告",
    ),
)
