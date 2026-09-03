"""闸 1 对 `/api/v1/platform/modeling-*` 的规则。

阶梯自下而上：981 写兜底 → 983 读 → 985 发起 / 取消运行 → 987 发布与绑定。
⚠ 每一级都必须压过它下面那一级，而整摞又都要压过 900 那几条按方法兜底的规则
——`{_PLATFORM}/*` 的 `*` **跨斜杠**，不压过去就成了拿别的码来删流水线。
"""

from auth_server.apps.auth.catalog.permissions import (
    MODELING_MANAGE,
    MODELING_PUBLISH,
    MODELING_RUN,
    MODELING_VIEW,
)
from auth_server.apps.auth.catalog.specs import RouteRuleSpec

_PLATFORM = "/api/v1/platform"

MODELING_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-*",
        "*",
        codes=(MODELING_MANAGE,),
        priority=981,
        description=(
            "建模面写操作的兜底：建改删流水线、校验、导入。"
            "⚠ 用 `*` 方法而不是逐个方法列，是为了让将来新增的方法也落在建模"
            "自己的码上"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-*",
        "GET",
        codes=(MODELING_VIEW,),
        priority=983,
        description=(
            "流水线、运行、节点结果、模型版本与绑定的读面，含算子目录。"
            "必须压过上面那条写兜底——那条用的是 `*` 方法，会把 GET 一并收进 "
            "manage，只读用户于是连算子面板都打不开"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-pipelines*:run",
        "POST",
        codes=(MODELING_RUN,),
        priority=985,
        description="发起一次运行。一次训练吃满一个核，不跟着 981 的 manage 走",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-runs*:cancel",
        "POST",
        codes=(MODELING_RUN,),
        priority=985,
        description="取消一次运行。与发起同一个码：起得来就该停得下",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-model-versions*",
        "*",
        codes=(MODELING_PUBLISH,),
        priority=987,
        description=(
            "发布与退役模型版本。⚠ 与运行分家：发布之后，引用那条公式的每一张"
            "台账的数值都会跟着模型走"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-bindings*",
        "*",
        codes=(MODELING_PUBLISH,),
        priority=987,
        description="建改删公式绑定、换绑版本。与发布同一个码，同一个爆炸半径",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-model-versions*",
        "GET",
        codes=(MODELING_VIEW,),
        priority=989,
        description=(
            "版本与绑定的读面。必须压过 987 那两条 `*` 方法的写规则，"
            "否则只读用户连模型指标都看不到"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-bindings*",
        "GET",
        codes=(MODELING_VIEW,),
        priority=989,
        description="同上，绑定列表与详情的读面",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-deployments*",
        "*",
        codes=(MODELING_PUBLISH,),
        priority=987,
        description=(
            "建改删对外服务、铸与撤销密钥。与发布同一个码：开一个对外服务"
            "等于把模型放到系统外面去，爆炸半径只大不小"
        ),
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-deployments*",
        "GET",
        codes=(MODELING_VIEW,),
        priority=989,
        description=(
            "对外服务与密钥的读面。必须压过 987 那条 `*` 方法的写规则，"
            "否则只读用户连有哪些服务在跑都看不到。"
            "⚠ 密钥列表里没有明文——明文只在铸出来那一次的回执里出现"
        ),
    ),
)

# 模型对外推理面。⚠ 单列一段是因为它是 platform 上第二个匿名可达的前缀，
# 混进上面那串会让「哪些路径不需要登录」在评审时看不出来。
OPEN_MODEL_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/open-models/*",
        "*",
        priority=950,
        description=(
            "按 API 密钥调模型。⚠ 空 codes 是「任意已登录用户」，"
            "**不是**匿名放行：真正的匿名可达性由边缘那条免认证 location 保证，"
            "这条只负责让带着密钥来的已登录用户不被 900 的方法兜底要走别的码。"
            "密钥本身由 platform-server 自己核对——它是业务资源，"
            "放进 auth-server 就要在两个服务之间同步一张表的生死，"
            "而 `/verify` 是全站每个请求都要过的热路径"
        ),
    ),
)
