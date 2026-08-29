"""闸 1 对组态大屏那一组的规则 —— 项目、大屏、画布节点、绑定、模块清单、
整屏模板与卡片样式库。

从 `rules_platform` 里分出来的一组：那一份把 platform 前缀下的九个面堆在一处，
过了模块行数上限。分域切法与 `rules_auth` / `rules_opcua` 那几份一致。

⚠ 阶梯必须在同一处看得见：`fnmatch` 的 `*` **跨斜杠**、首条命中即终局，
窄规则的 priority 压不过兜底就等于没写。
"""

from auth_server.apps.auth.catalog.permissions import (
    DASHBOARD_EDIT,
    DASHBOARD_MANAGE,
    DASHBOARD_VIEW,
)
from auth_server.apps.auth.catalog.specs import RouteRuleSpec

_PLATFORM = "/api/v1/platform"

# 组态大屏（`dashboard-projects` / `dashboards` / `dashboard-nodes` /
# `dashboard-bindings` / `module-types`）。阶梯自下而上：
# 910 写兜底 → 912 读 → 915 建删 → 920 动作端点（自检、发布、取消发布）。
DASHBOARD_RULES: tuple[RouteRuleSpec, ...] = (
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
        f"{_PLATFORM}/card-styles*",
        "*",
        codes=(DASHBOARD_MANAGE,),
        priority=910,
        description=(
            "卡片样式库的写面。⚠ 这个资源**不带 `dashboard` 前缀**，上面那两条"
            "按 `dashboard*` 的规则一条都盖不到它；没有本条它会掉进 900 的方法"
            "兜底，表现是「只有大屏权限的人在边缘就被 403」。归 manage 而不是"
            "edit：样式是全站共享的资产，加一条等于给所有大屏加一个可套用的"
            "起点，与另存为模板同档"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/card-styles*",
        "GET",
        codes=(DASHBOARD_VIEW,),
        priority=912,
        description=(
            "卡片样式库的读面。必须压过上面那条写兜底——那条用的是 `*` 方法，"
            "会把 GET 一并收进 manage，于是只读用户连样式墙都打不开"
        ),
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
        f"{_PLATFORM}/dashboards/*/publication",
        "GET",
        codes=(DASHBOARD_MANAGE,),
        priority=920,
        description=(
            "读一张屏此刻的公开令牌。⚠ 归 manage 且必须压过 912 那条读兜底："
            "读到的就是那条谁拿到谁能看的链接，能不能发出去与能不能看见这张屏"
            "不是同一件事"
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
