"""闸 1 对 `/api/v1/platform` 的规则 —— 空调、组态大屏、数据采集三面。

三面共用一个 URL 前缀，故它们的优先级阶梯必须在同一处看得见：`fnmatch` 的
`*` 跨斜杠、首条命中即终局，窄规则的 priority 压不过兜底就等于没写。
"""

from auth_server.apps.auth.catalog.permissions import (
    AC_MANAGE,
    AC_VIEW,
    ASSET_MANAGE,
    ASSET_VIEW,
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
# 910 写兜底 → 912 读 → 915 建删 → 920 动作端点（自检、发布、取消发布）。
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
        f"{_PLATFORM}/dashboard-projects/*/themes*",
        "*",
        codes=(DASHBOARD_EDIT,),
        priority=918,
        description=(
            "项目自定义主题的增删改。⚠ 必须比上面 915 那两条项目规则更窄、"
            "更靠前：`fnmatch` 的 `*` **跨斜杠**，`dashboard-projects/*` 的 "
            "PATCH/DELETE 同样匹配 `/{id}/themes/{id}`，排在后面就会让改一个"
            "主题需要删项目的码——只有编辑权的人配不了色"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboard-projects/*/themes*",
        "GET",
        codes=(DASHBOARD_VIEW,),
        priority=919,
        description=(
            "列项目主题。⚠ 必须压过上面那条 918 的写兜底——那条用的是 `*` "
            "方法，会把 GET 一并收进 edit，只读用户于是连配色都读不到"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboard-templates",
        "POST",
        codes=(DASHBOARD_MANAGE,),
        priority=915,
        description=(
            "另存为模板。⚠ 模板是**全局**的：建一份等于给所有项目加一个"
            "可复制的起点，故与建屏同档而不是落到 910 的 edit"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboard-templates/*",
        "DELETE",
        codes=(DASHBOARD_MANAGE,),
        priority=915,
        description="删模板。影响全部引用方，与删屏同档",
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
    RouteRuleSpec(
        f"{_PLATFORM}/dashboards/*:publish",
        "POST",
        codes=(DASHBOARD_MANAGE,),
        priority=920,
        description=(
            "发布大屏，换发公开令牌。⚠ 归 manage 而不是 910 兜底的 edit："
            "公开一张屏是把它交给全互联网，与改一行配置不是同一类操作"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboards/*:unpublish",
        "POST",
        codes=(DASHBOARD_MANAGE,),
        priority=920,
        description="撤回公开。与发布同档，能发布的才能撤回",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboards/*:duplicate",
        "POST",
        codes=(DASHBOARD_MANAGE,),
        priority=920,
        description=(
            "复制大屏。⚠ 归 manage 不归 910 兜底的 edit：它**建出一张新屏**，"
            "与「建大屏」同一类，而不是改一张已有的"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboards/*:export",
        "POST",
        codes=(DASHBOARD_VIEW,),
        priority=920,
        description=(
            "导出大屏，不改任何东西，是 POST 只因动作端点一律 POST。"
            "⚠ 必须排在 910 前缀兜底之前，否则只读用户导不出自己看得见的屏"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboards:import",
        "POST",
        codes=(DASHBOARD_MANAGE,),
        priority=920,
        description=(
            "导入大屏。⚠ 模式**不带 `*`**：它是集合上的动作端点，"
            "写成 `dashboards/*:import` 匹配不上，写成带 `*` 的宽模式则会把 "
            "`/dashboards/*` 底下一切 POST 一并收进 manage"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dashboard-templates/*:instantiate",
        "POST",
        codes=(DASHBOARD_MANAGE,),
        priority=920,
        description=(
            "从模板实例化出一张新屏。与复制同档：产出的是新屏，不是改动"
        ),
    ),
)

# 运行参数。⚠ 它不匹配 `dashboard*` 也不匹配 `collect-*`，没有这两条就会掉进
# 900 的按方法兜底，表现是「改推送节拍要 `ac:manage`」——一个管空调的角色能调
# 全平台大屏的推送行为，而管大屏的角色反而调不了。
_RUNTIME_PARAM_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/runtime-params*",
        "*",
        codes=(DASHBOARD_EDIT,),
        priority=925,
        description=(
            "改运行参数与恢复默认。本前缀只服务看板 scope，故取"
            " `dashboard:edit`；采集/归档两组挂在 `collect-runtime-params`"
            " 前缀下，由 930/932 的采集兜底给出 collect:* 口径"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/runtime-params*",
        "GET",
        codes=(DASHBOARD_VIEW,),
        priority=927,
        description=(
            "看当前取值。只读用户也该看得见节拍——看得见不等于能改，"
            "改的那一档由上面那条与端点自己的写码一起守"
        ),
    ),
)

# 公开只读面。⚠ 单列一段是因为它是整个 platform 唯一的匿名可达前缀，混进上面
# 那串会让「哪些路径不需要登录」在评审时看不出来。
_PUBLIC_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/public-dashboards/*",
        "*",
        priority=950,
        description=(
            "按公开令牌读已发布的大屏。⚠ 空 codes 是「任意已登录用户」，"
            "**不是**匿名放行：真正的匿名可达性由边缘那条免认证 location 保证，"
            "这条只负责让带着令牌来的已登录用户不被 900 的方法兜底要走 "
            "`ac:view`"
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
        f"{_PLATFORM}/collect-sources/*:browse-subtree",
        "POST",
        codes=(COLLECT_OPERATE,),
        priority=940,
        description=(
            "一次收齐一棵子树，会在现场设备上产生几百次往返。"
            "⚠ 必须单列一条：上面那条 `*:browse` 是**全串**匹配，"
            "`:browse-subtree` 落不进去，会掉到 930 的写兜底上——"
            "表现是持 `collect:operate` 的现场人员勾不了上层节点"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/collect-points/*:write",
        "POST",
        codes=(COLLECT_OPERATE,),
        priority=940,
        description="下发写值，等于改变现场设备的实际状态",
    ),
)

# 素材库。阶梯：921 写兜底 → 922 读。两条都必须压过 900 那五条按方法兜底的
# 规则——`{_PLATFORM}/*` 的 `*` **跨斜杠**，不压过去就成了拿 `ac:manage` 删素材。
# ⚠ 直传凭证与 finalize 都是 POST，落在 921 的写兜底里，正是它们要的 manage：
# 单列一条动作规则反而会在将来新增动作端点时漏掉那一个
_ASSET_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/assets*",
        "*",
        codes=(ASSET_MANAGE,),
        priority=921,
        description=(
            "素材面写操作的兜底：申请直传凭证、确认上传、删除。"
            "⚠ 用 `*` 方法而不是逐个方法列，是为了让将来新增的方法也落在素材"
            "自己的码上"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/assets*",
        "GET",
        codes=(ASSET_VIEW,),
        priority=922,
        description=(
            "素材列表、详情与类型目录。必须压过上面那条写兜底——那条用的是 "
            "`*` 方法，会把 GET 一并收进 manage，只读用户于是连素材名都看不到"
        ),
    ),
)

PLATFORM_RULES: tuple[RouteRuleSpec, ...] = (
    *_PROBE_RULES,
    *_HVAC_RULES,
    *_DASHBOARD_RULES,
    *_RUNTIME_PARAM_RULES,
    *_COLLECT_RULES,
    *_ASSET_RULES,
    *_PUBLIC_RULES,
)
