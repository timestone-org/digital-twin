"""闸 1 对 `/api/v1/platform/modeling-*` 的规则。

阶梯自下而上：981 写兜底 → 983 读 → 985 发起 / 取消运行 → 987 发布与绑定
→ 989 版本 / 绑定 / 服务的读面 → 991 下载全量结果（要两个码）。
⚠ 每一级都必须压过它下面那一级，而整摞又都要压过 900 那几条按方法兜底的规则
——`{_PLATFORM}/*` 的 `*` **跨斜杠**，不压过去就成了拿别的码来删流水线。
"""

from auth_server.apps.auth.catalog.permissions import (
    DATASET_RECORD_EXPORT,
    MODELING_MANAGE,
    MODELING_PUBLISH,
    MODELING_RUN,
    MODELING_VIEW,
)
from auth_server.apps.auth.catalog.specs import RouteRuleSpec

_PLATFORM = "/api/v1/platform"

MODELING_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-instances*",
        "*",
        codes=(MODELING_RUN,),
        priority=985,
        description="通过已有模板创建、配置和训练模型实例",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-instances*",
        "GET",
        codes=(MODELING_VIEW,),
        priority=989,
        description="查看模型实例与全部参数 Schema",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/modeling-instances*:deploy",
        "POST",
        codes=(MODELING_PUBLISH,),
        priority=991,
        description="部署实例的指定不可变模型版本",
    ),
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
        f"{_PLATFORM}/modeling-runs*/frames*",
        "GET",
        codes=(MODELING_VIEW, DATASET_RECORD_EXPORT),
        priority=991,
        description=(
            "下载一次运行的全量结果。⚠ 要**两个**码：那份 CSV 里是台账原始"
            "数据，「能看」不等于「能带走」。必须压过 983 那条读面规则，"
            "否则只有 `modeling:view` 的账号也能把整段历史拉走"
        ),
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
            "历史部署密钥仅保留查询与撤销，不再签发"
        ),
    ),
)

# 模型调用与建模读取共用账号权限
OPEN_MODEL_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(
        f"{_PLATFORM}/open-models/*",
        "*",
        codes=(MODELING_VIEW,),
        priority=950,
        description="模型签名、预测、检测与计算统一使用账号鉴权及建模查看权限。",
    ),
)
