"""闸 1 对 `/api/v1/platform` 的规则 —— 空调、运行参数、数据采集、素材库与
数据台账。组态大屏那一组在 `rules_dashboard`，那一份太大、单独成篇。

各面共用一个 URL 前缀，故它们的优先级阶梯必须在同一处看得见：`fnmatch` 的
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
    DASHBOARD_VIEW,
    DATASET_BACKFILL,
    DATASET_MANAGE,
    DATASET_OVERRIDE,
    DATASET_RECORD_WRITE,
    DATASET_VIEW,
    FORMULA_MANAGE,
    FORMULA_VIEW,
    LLM_MANAGE,
    LLM_VIEW,
)
from auth_server.apps.auth.catalog.rules_dashboard import DASHBOARD_RULES
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
            "素材面写操作的兜底：申请直传凭证、确认上传、改名、重压、删除。"
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

# 数据台账。阶梯自下而上：960 写兜底 → 962 读 → 964 重算 → 966 记录写 →
# 968 记录读 → 970 单行修正 → 972 批量撤销修正 → 974 回填 → 976 回填进度读。
# 每一级都必须压过它下面那一级，
# 而整摞又都要压过 900 那五条按方法兜底的规则——`{_PLATFORM}/*` 的 `*`
# **跨斜杠**，不压过去就成了拿 `ac:manage` 删台账。
# ⚠ 顺序在这里是承重的：`records*` 的 `*` 同样跨斜杠，966 的写兜底会把
# `GET …/records` 一并收进 `record:write`，故 968 必须压在它上面；同理
# `…/records/{rid}/overrides` 落在 966 的范围里，970 必须再压过 968。
# ⚠ `columns:reorder` 是 POST 且真的改数据，落在 960 的写兜底里正是它要的
# manage：单列一条动作规则反而会在将来新增动作端点时漏掉那一个。
_DATASET_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/dataset-tables*",
        "*",
        codes=(DATASET_MANAGE,),
        priority=960,
        description=(
            "台账面写操作的兜底：建改删台账、列的增删改与整体重排。"
            "⚠ 用 `*` 方法而不是逐个方法列，是为了让将来新增的方法也落在台账"
            "自己的码上"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dataset-tables*",
        "GET",
        codes=(DATASET_VIEW,),
        priority=962,
        description=(
            "台账列表、详情与列定义。必须压过上面那条写兜底——那条用的是 `*` "
            "方法，会把 GET 一并收进 manage，只读用户于是连表头都看不到"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dataset-tables*:recompute",
        "POST",
        codes=(DATASET_BACKFILL,),
        priority=964,
        description=(
            "按时间范围重算公式列。⚠ 一次会改写大批历史行并吃满数据库，"
            "不跟着 960 的 manage 走"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dataset-tables*/records*",
        "*",
        codes=(DATASET_RECORD_WRITE,),
        priority=966,
        description=(
            "记录面写操作的兜底：录入、编辑、删除单行。⚠ 用 `*` 方法而不是"
            "逐个方法列，是为了让将来新增的方法也落在记录自己的码上"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dataset-tables*/records*",
        "GET",
        codes=(DATASET_VIEW,),
        priority=968,
        description=(
            "数据行翻页。必须压过上面那条写兜底——那条用的是 `*` 方法，"
            "会把 GET 一并收进 record:write，只读用户于是连一行数据都翻不出来"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dataset-tables*/records*/overrides",
        "*",
        codes=(DATASET_OVERRIDE,),
        priority=970,
        description=(
            "写与撤销单行的人工修正。⚠ 修正值优先于自动采集值，等同于篡改"
            "台账，故不跟着 966 的记录写走"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dataset-tables*/backfill",
        "*",
        codes=(DATASET_BACKFILL,),
        priority=974,
        description=(
            "起与取消历史回填。⚠ 一次会按点位历史重算一大段时间的台账行，"
            "爆炸半径与 964 的重算同级，不跟着 960 的 manage 走"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dataset-tables*/backfill",
        "GET",
        codes=(DATASET_VIEW,),
        priority=976,
        description=(
            "查回填进度。必须压过上面那条——那条用的是 `*` 方法，会把 GET 一并"
            "收进 backfill，于是只想看一眼进度的人反而要拿到改写历史的权限"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/dataset-tables*/overrides:clear",
        "POST",
        codes=(DATASET_OVERRIDE,),
        priority=972,
        description=(
            "按列 + 时间范围批量撤销人工修正。⚠ 它的路径里没有 `records` 段，"
            "落不进 970 那条，必须单列"
        ),
    ),
)

# 公式库。⚠ 它与 `dataset-tables` **平级**——路径里没有 `dataset-tables` 段，
# 落不进上面那摞台账规则的任何一条，必须自成一档；不写就掉进 900 的方法兜底，
# 表现是「改一条影响全部台账的公式只要 `ac:manage`」。
# ⚠ 阶梯与台账同理：955 写兜底在下，957 读在上。反过来的话，`*` 方法的写兜底
# 会把 GET 一并收进 manage，只有读权限的人连公式库列表都打不开。
_FORMULA_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/formulas*",
        "*",
        codes=(FORMULA_MANAGE,),
        priority=955,
        description=(
            "公式库写操作的兜底：建改删库公式、停用与恢复出厂口径。"
            "⚠ 用 `*` 方法而不是逐个方法列，是为了让将来新增的方法也落在"
            "公式库自己的码上"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/formulas*",
        "GET",
        codes=(FORMULA_VIEW,),
        priority=957,
        description=(
            "公式库列表、详情与引用反查。必须压过上面那条写兜底——那条用的是 "
            "`*` 方法，会把 GET 一并收进 manage，只读用户于是连库里有哪些"
            "公式都看不到"
        ),
    ),
)

# 模型供应商目录（ADR-0039）。阶梯：923 写兜底 → 924 读。两条都必须压过 900
# 那五条按方法兜底的规则——不压过去就成了拿 `ac:manage` 改整套部署的模型密钥。
# ⚠ `llm-*` 同时罩住 `llm-providers*` 与 `llm-purposes*`：两族共一套码，分开写
# 只会在将来加第三族时漏一条。探测那两条动作端点是 POST，落在写兜底里正是它们
# 要的 manage——拿着密钥去打外部地址，不该只要读码
_LLM_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/llm-*",
        "*",
        codes=(LLM_MANAGE,),
        priority=923,
        description=(
            "模型供应商面写操作的兜底：增删改供应商与密钥、给用途分配模型、"
            "测试端点。⚠ 用 `*` 方法而不是逐个方法列，是为了让将来新增的"
            "方法也落在供应商自己的码上"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/llm-*",
        "GET",
        codes=(LLM_VIEW,),
        priority=924,
        description=(
            "供应商列表、详情与用途清单。必须压过上面那条写兜底——那条用的是 "
            "`*` 方法，会把 GET 一并收进 manage，只读用户于是连接了哪几路"
            "都看不到"
        ),
    ),
)

PLATFORM_RULES: tuple[RouteRuleSpec, ...] = (
    *_PROBE_RULES,
    *_HVAC_RULES,
    *DASHBOARD_RULES,
    *_RUNTIME_PARAM_RULES,
    *_COLLECT_RULES,
    *_ASSET_RULES,
    *_LLM_RULES,
    *_DATASET_RULES,
    *_FORMULA_RULES,
    *_PUBLIC_RULES,
)
