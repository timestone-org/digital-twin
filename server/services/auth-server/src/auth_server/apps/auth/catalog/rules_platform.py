"""闸 1 对 `/api/v1/platform` 的规则 —— 空调、组态大屏、数据采集三面。

三面共用一个 URL 前缀，故它们的优先级阶梯必须在同一处看得见：`fnmatch` 的
`*` 跨斜杠、首条命中即终局，窄规则的 priority 压不过兜底就等于没写。
"""

from auth_server.apps.auth.catalog.permissions import (
    AC_MANAGE,
    AC_VIEW,
    COLLECT_MANAGE,
    COLLECT_OPERATE,
    COLLECT_VIEW,
    DASHBOARD_EDIT,
    DASHBOARD_MANAGE,
    DASHBOARD_VIEW,
)
from auth_server.apps.auth.catalog.specs import RouteRuleSpec

_PLATFORM = "/api/v1/platform"

_PROBE_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/health", "GET", priority=999, description="存活探针"
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/ready", "GET", priority=999, description="就绪探针"
    ),
    RouteRuleSpec(f"{_PLATFORM}/docs", "GET", priority=998, description="文档"),
    RouteRuleSpec(
        f"{_PLATFORM}/redoc", "GET", priority=998, description="文档"
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/openapi.json", "GET", priority=998, description="契约"
    ),
)

_HVAC_RULES: tuple[RouteRuleSpec, ...] = (
    # 试算与推荐是纯计算的读操作（POST 只因它带请求体）：viewer 也该能问
    # 「这样开多久达标」「今天开哪套最快」。窄规则压过下面按方法兜底的写权限
    RouteRuleSpec(
        f"{_PLATFORM}/ac-models/*:predict",
        "POST",
        codes=(AC_VIEW,),
        priority=905,
        description="达标时长试算，读档权限即可",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/ac-models/*:recommend",
        "POST",
        codes=(AC_VIEW,),
        priority=906,
        description="开机策略推荐，读档权限即可",
    ),
    # ⚠ `fnmatch` 的 `*` 跨斜杠，故这五条按方法兜住 platform 的整个对外面。
    # 将来某个资源要单独的码，加一条更高 priority 的窄规则压过它，别改这五条。
    RouteRuleSpec(
        f"{_PLATFORM}/*",
        "GET",
        codes=(AC_VIEW,),
        priority=900,
        description="空调、车间、房间的全部读面",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/*",
        "POST",
        codes=(AC_MANAGE,),
        priority=900,
        description="新建与批量改派",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/*",
        "PUT",
        codes=(AC_MANAGE,),
        priority=900,
        description="覆盖式写：数据源绑定与达标范围",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/*",
        "PATCH",
        codes=(AC_MANAGE,),
        priority=900,
        description="更新空调、车间、房间",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/*",
        "DELETE",
        codes=(AC_MANAGE,),
        priority=900,
        description="删除空调、车间、房间",
    ),
)

# 组态大屏（`dashboard-projects` / `dashboards` / `dashboard-nodes` /
# `dashboard-bindings` / `module-types`）。阶梯自下而上：
# 910 写兜底 → 912 读 → 915 建删 → 920 自检动作端点。
_DASHBOARD_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/dashboard*",
        "*",
        codes=(DASHBOARD_EDIT,),
        priority=910,
        description=(
            "大屏面写操作的兜底：项目、大屏、画布节点、绑定的一切非读方法。"
            "⚠ 用 `*` 方法而不是逐个方法列，是为了让将来新增的方法也落在大屏"
            "自己的码上——落到 900 那五条就变成拿 `ac:manage` 能改大屏"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboard*",
        "GET",
        codes=(DASHBOARD_VIEW,),
        priority=912,
        description="大屏面的全部读面。必须压过上面那条写兜底",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/module-types*",
        "GET",
        codes=(DASHBOARD_VIEW,),
        priority=912,
        description="模块清单只读，它是编辑器与 Agent 的地图，没有写面",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboard-projects",
        "POST",
        codes=(DASHBOARD_MANAGE,),
        priority=915,
        description="建项目。⚠ 模式不带 `*`：项目下的子资源不归 manage",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboard-projects/*",
        "PATCH",
        codes=(DASHBOARD_MANAGE,),
        priority=915,
        description="改项目",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboard-projects/*",
        "DELETE",
        codes=(DASHBOARD_MANAGE,),
        priority=915,
        description="删项目",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboards",
        "POST",
        codes=(DASHBOARD_MANAGE,),
        priority=915,
        description=(
            "建大屏。⚠ 模式不带 `*`：`:replace-layout` 与 `/nodes` 同样是"
            " POST，带上 `*` 会把它们一并收进 manage，编辑者就改不动大屏了"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboards/*",
        "DELETE",
        codes=(DASHBOARD_MANAGE,),
        priority=915,
        description="删大屏，它的节点与绑定一并消失",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboards/*:validate",
        "POST",
        codes=(DASHBOARD_VIEW,),
        priority=920,
        description=(
            "大屏自检，只列悬空引用、不改任何东西，是 POST 只因动作端点一律"
            " POST。⚠ 动作端点必须排在 910 的前缀兜底之前：`*` 跨斜杠，"
            "排在后面它就会被当成一次编辑，只读用户看不了自己那张屏的体检报告"
        ),
    ),
)

# 数据采集（`collect-sources` / `collect-points` / `point-histories`）。
# 阶梯自下而上：930 写兜底 → 932 读 → 940 动作端点。
_COLLECT_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/collect-*",
        "*",
        codes=(COLLECT_MANAGE,),
        priority=930,
        description=(
            "数据源与点位写操作的兜底。⚠ 用 `*` 方法的理由同大屏面那条："
            "新增的方法落到 900 那五条就变成拿 `ac:manage` 能改采集配置"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/collect-*",
        "GET",
        codes=(COLLECT_VIEW,),
        priority=932,
        description="数据源与点位的全部读面。必须压过上面那条写兜底",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/point-histories*",
        "*",
        codes=(COLLECT_MANAGE,),
        priority=930,
        description=(
            "历史读侧眼下没有写面，这条只为把将来可能出现的写方法钉在采集的"
            "码上，而不是让它落到 900 那五条上去要 `ac:manage`"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/point-histories*",
        "GET",
        codes=(COLLECT_VIEW,),
        priority=932,
        description="按点位与时间区间取历史读数，游标分页",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/point-histories:aggregate",
        "POST",
        codes=(COLLECT_VIEW,),
        priority=940,
        description=(
            "历史分桶聚合，不改任何东西，故按读面放行。"
            "⚠ 动作端点必须排在 930 的前缀兜底之前，否则只读用户看不了曲线"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/collect-sources/*:test",
        "POST",
        codes=(COLLECT_OPERATE,),
        priority=940,
        description=(
            "连通性测试，会走命令总线让采集进程真连一次现场。"
            "⚠ 排在 930 的前缀兜底之前，否则它会被当成一次改配置"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/collect-sources/*:browse",
        "POST",
        codes=(COLLECT_OPERATE,),
        priority=940,
        description="浏览地址空间，同样会在现场设备上产生一次真实往返",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/collect-points/*:write",
        "POST",
        codes=(COLLECT_OPERATE,),
        priority=940,
        description="下发写值，等于改变现场设备的实际状态",
    ),
)

PLATFORM_RULES: tuple[RouteRuleSpec, ...] = (
    *_PROBE_RULES,
    *_HVAC_RULES,
    *_DASHBOARD_RULES,
    *_COLLECT_RULES,
)
