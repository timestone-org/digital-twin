"""权限码目录 —— 全系统权限口径的唯一真源。

只登记**已经有消费方**的码：无端点无页面的占位码不进目录，否则角色配置界面
会摆出一排点了没有任何效果的开关。划分口径与四个档位见 auth-server 的
CONTEXT.md。
"""

from auth_server.apps.auth.catalog.specs import PermissionGroup, PermissionSpec

USER_VIEW = "user:view"
USER_MANAGE = "user:manage"
USER_DELETE = "user:delete"
USER_GRANT = "user:grant"
ROLE_MANAGE = "role:manage"
ROUTE_RULE_VIEW = "route_rule:view"
ROUTE_RULE_MANAGE = "route_rule:manage"
# platform-server 的 apps/hvac 消费这两个码。服务之间不许互相 import，
# 那边的 apps/hvac/catalog.py 只是复述，两边必须逐字一致
AC_VIEW = "ac:view"
AC_MANAGE = "ac:manage"
OPCUA_VIEW = "opcua:view"
OPCUA_OPERATE = "opcua:operate"
OPCUA_MANAGE = "opcua:manage"
# platform-server 的 apps/dashboard 与 apps/collect 各复述一份，同上
DASHBOARD_VIEW = "dashboard:view"
DASHBOARD_EDIT = "dashboard:edit"
DASHBOARD_MANAGE = "dashboard:manage"
COLLECT_VIEW = "collect:view"
COLLECT_OPERATE = "collect:operate"
COLLECT_MANAGE = "collect:manage"
# platform-server 的 apps/assets 复述一份，同上。素材是跨大屏的公共资源，
# 故自成一族而不是挂在 dashboard 下：把删素材的权力顺带发给每个能编大屏的人，
# 一次误删会同时打穿引用它的每一张屏
ASSET_VIEW = "asset:view"
ASSET_MANAGE = "asset:manage"
# platform-server 的 apps/dataset 复述一份，同上。⚠ 台账的划分依据是**爆炸半径**
# 而不是「读 / 写」，完整的八个码见 docs/DATASET_DESIGN.md §9；这里只登记已经有
# 端点的五个，导出与公式库那三个各自随端点落地时再加
# ai-assistant 复述一份，同上。⚠ **助手不是绕过权限的通道**：它改的是浏览器里
# 的草稿，最终保存仍走 `dashboard:edit`；服务端工具代表用户调 platform 时也带着
# 用户自己的身份头。所以这两个码管的只是「能不能用助手」，不是「能改什么」
# ⚠ manage 管的是**模型凭据**（`/credentials*` 那一族），不是「看得见别人的
# 会话」——后者是在同一个 URL 上按调用者分支判的，而闸 1 的规则按 路径 + 方法
# 匹配，表达不了它；一个没有任何规则要它的码，在角色配置界面上就是一个点了
# 没效果的开关。凭据面有自己的路径，所以它登记得起来。
ASSISTANT_USE = "assistant:use"
ASSISTANT_MANAGE = "assistant:manage"
DATASET_VIEW = "dataset:view"
DATASET_MANAGE = "dataset:manage"
DATASET_RECORD_WRITE = "dataset:record:write"
DATASET_OVERRIDE = "dataset:override"
DATASET_BACKFILL = "dataset:backfill"
# 公式库是**跨台账的全局资源**，故与台账那五个码分家：改一条库公式会同时改掉
# 所有引用它的台账列，爆炸半径大一个量级（docs/DATASET_DESIGN.md §9）
FORMULA_VIEW = "formula:view"
FORMULA_MANAGE = "formula:manage"
# platform-server 的 apps/modeling 复述一份，同上。⚠ `run` 与 `publish` 必须
# 分家：能跑实验 ≠ 能把模型接进生产台账——发布之后，引用那条公式条目的每一张
# 台账的数值都会跟着变，爆炸半径与 `formula:manage` 同一量级
MODELING_VIEW = "modeling:view"
MODELING_MANAGE = "modeling:manage"
MODELING_RUN = "modeling:run"
MODELING_PUBLISH = "modeling:publish"
# knowledge-server 复述一份，同上。⚠ 粒度是**这个库**而不是这份文档：
# 一期不做文档级权限，界面上要说清这件事，别让人以为传进去的东西只有自己看得见。
# ⚠ 这里**只有 use 一个码**。设计里还有 `knowledge:write` 与 `knowledge:manage`
# （见 docs/KNOWLEDGE_BASE_DESIGN.md §6），但闸 1 的规则按 路径 + 方法 匹配，
# 而它们要管的那些路径此刻一条都还没有——现在登记进来就是一个没有任何规则要它的
# 死开关，在角色配置界面上表现为一个点了没效果的勾。各自随端点落地时再加
KNOWLEDGE_USE = "knowledge:use"

PERMISSIONS: tuple[PermissionSpec, ...] = (
    PermissionSpec(
        code=USER_VIEW,
        name="查看用户与角色",
        kind="view",
        group_code="user",
        group_label="用户与角色",
        sort_order=10,
        description="用户列表与详情、角色列表与详情、权限目录的全部读面",
    ),
    PermissionSpec(
        code=USER_MANAGE,
        name="管理用户",
        kind="manage",
        group_code="user",
        group_label="用户与角色",
        sort_order=20,
        description="新建用户、编辑资料、启停账号、重置他人密码",
    ),
    PermissionSpec(
        code=USER_DELETE,
        name="删除用户",
        kind="admin",
        group_code="user",
        group_label="用户与角色",
        sort_order=30,
        description="删除账号，不可恢复",
    ),
    PermissionSpec(
        code=USER_GRANT,
        name="授予用户角色与直权",
        kind="admin",
        group_code="user",
        group_label="用户与角色",
        sort_order=40,
        description="改派角色、覆盖式写用户直权。提权入口",
    ),
    PermissionSpec(
        code=ROLE_MANAGE,
        name="管理角色与角色权限",
        kind="admin",
        group_code="user",
        group_label="用户与角色",
        sort_order=50,
        description="建改删角色、覆盖式设置角色权限。整套 RBAC 的提权入口",
    ),
    PermissionSpec(
        code=ROUTE_RULE_VIEW,
        name="查看路由权限规则",
        kind="view",
        group_code="system",
        group_label="系统配置",
        sort_order=10,
        description="鉴权矩阵的列表与详情",
    ),
    PermissionSpec(
        code=ROUTE_RULE_MANAGE,
        name="管理路由权限规则",
        kind="admin",
        group_code="system",
        group_label="系统配置",
        sort_order=20,
        description="增删改路由规则，改动即改变全系统鉴权矩阵",
    ),
    PermissionSpec(
        code=AC_VIEW,
        name="查看空调与空间",
        kind="view",
        group_code="hvac",
        group_label="空调与空间",
        sort_order=10,
        description="空调台账、车间与房间的全部读面",
    ),
    PermissionSpec(
        code=AC_MANAGE,
        name="管理空调与空间",
        kind="manage",
        group_code="hvac",
        group_label="空调与空间",
        sort_order=20,
        description="增删改空调、车间、房间，以及批量改派空调所在房间",
    ),
    PermissionSpec(
        code=OPCUA_VIEW,
        name="查看 OPC UA 服务端",
        kind="view",
        group_code="opcua",
        group_label="OPC UA 服务端",
        sort_order=10,
        description="实例、地址空间节点、在线会话与端口池的全部读面",
    ),
    PermissionSpec(
        code=OPCUA_OPERATE,
        name="起停实例与写节点值",
        kind="operate",
        group_code="opcua",
        group_label="OPC UA 服务端",
        sort_order=20,
        description=(
            "起停/重启实例、向节点写值。⚠ 停实例会断开全部上位机会话；"
            "写值等于改变上位系统读到的现场数据"
        ),
    ),
    PermissionSpec(
        code=OPCUA_MANAGE,
        name="管理实例、节点与接入凭据",
        kind="admin",
        group_code="opcua",
        group_label="OPC UA 服务端",
        sort_order=30,
        description=(
            "增删实例与节点、改安全策略、管理上位机凭据与信任证书。"
            "⚠ 归高危档是因为后半段决定「哪台上位机连得进来」"
        ),
    ),
    PermissionSpec(
        code=DASHBOARD_VIEW,
        name="查看组态大屏",
        kind="view",
        group_code="dashboard",
        group_label="组态大屏",
        sort_order=10,
        description=(
            "项目、大屏、画布节点、点位绑定与模块清单的全部读面，"
            "含只列悬空引用、不改任何东西的大屏自检"
        ),
    ),
    PermissionSpec(
        code=DASHBOARD_EDIT,
        name="编辑大屏内容",
        kind="manage",
        group_code="dashboard",
        group_label="组态大屏",
        sort_order=20,
        description=(
            "改大屏元数据、整树替换布局、增删改画布节点与点位绑定。"
            "改的是一张已有大屏的内容，建不了也删不掉大屏本身"
        ),
    ),
    PermissionSpec(
        code=DASHBOARD_MANAGE,
        name="管理项目与大屏",
        kind="admin",
        group_code="dashboard",
        group_label="组态大屏",
        sort_order=30,
        description=(
            "新建与删除项目、新建与删除大屏。⚠ 归高危档是因为删一张大屏会把"
            "它的节点与绑定一并删掉，删项目同理，两者都不可恢复"
        ),
    ),
    PermissionSpec(
        code=COLLECT_VIEW,
        name="查看采集配置与历史",
        kind="view",
        group_code="collect",
        group_label="数据采集",
        sort_order=10,
        description=(
            "数据源与点位的全部读面，以及点位历史读数的查询与分桶聚合。"
            "接入凭据只回「配过没配过」，任何读面都不回它的取值"
        ),
    ),
    PermissionSpec(
        code=COLLECT_OPERATE,
        name="连测现场与下发写值",
        kind="operate",
        group_code="collect",
        group_label="数据采集",
        sort_order=20,
        description=(
            "数据源连通性测试、浏览地址空间、向点位下发写值。"
            "⚠ 三者都会在现场设备上产生一次真实往返，写值等于改变设备状态"
        ),
    ),
    PermissionSpec(
        code=COLLECT_MANAGE,
        name="管理数据源与点位",
        kind="manage",
        group_code="collect",
        group_label="数据采集",
        sort_order=30,
        description=(
            "增删改数据源与点位，含接入凭据、采集周期、死区与归档保留期。"
            "改完即广播新采集计划，采集进程随之改变它在现场读什么"
        ),
    ),
    PermissionSpec(
        code=ASSISTANT_USE,
        name="使用 AI 助手",
        kind="operate",
        group_code="assistant",
        group_label="AI 助手",
        sort_order=10,
        description=(
            "开对话、让助手动手。⚠ 它动的是浏览器里的草稿，"
            "最终保存仍按各自的码判——只有这个码存不下任何东西"
        ),
    ),
    PermissionSpec(
        code=ASSISTANT_MANAGE,
        name="管理助手模型凭据",
        kind="manage",
        group_code="assistant",
        group_label="AI 助手",
        sort_order=20,
        description=(
            "登录/退出模型账号，看得见凭据的过期时刻与所属账号。"
            "⚠ 它是**整套部署共用的一份凭据**：换掉之后，"
            "所有人的助手立刻改用新账号说话"
        ),
    ),
    PermissionSpec(
        code=ASSET_VIEW,
        name="查看素材",
        kind="view",
        group_code="asset",
        group_label="素材库",
        sort_order=10,
        description=(
            "素材列表与详情、可上传的类型与大小上限。"
            "字节本身由边缘直接反代对象存储，不经过本码"
        ),
    ),
    PermissionSpec(
        code=ASSET_MANAGE,
        name="管理素材",
        kind="manage",
        group_code="asset",
        group_label="素材库",
        sort_order=20,
        description=(
            "上传与删除素材。⚠ 删除不做引用检查：一个模型可能被多张大屏引用，"
            "删掉之后那些屏上会显示「取不到」"
        ),
    ),
    PermissionSpec(
        code=DATASET_VIEW,
        name="查看数据台账",
        kind="view",
        group_code="dataset",
        group_label="数据台账",
        sort_order=10,
        description="台账列表与详情、列定义的全部读面",
    ),
    PermissionSpec(
        code=DATASET_MANAGE,
        name="管理数据台账",
        kind="manage",
        group_code="dataset",
        group_label="数据台账",
        sort_order=20,
        description=(
            "建改删台账、列的增删改与排序。⚠ 删列会让引用它的公式列算不出数，"
            "删台账（force）会连历史数据行一起删掉，两者都不可逆"
        ),
    ),
    PermissionSpec(
        code=DATASET_RECORD_WRITE,
        name="录入与修改台账数据",
        kind="manage",
        group_code="dataset",
        group_label="数据台账",
        sort_order=30,
        description=(
            "新增、修改、删除单行数据。⚠ 与「管理数据台账」分家是按爆炸"
            "半径切的：改表结构影响的是往后每一行，改一行只影响那一行"
        ),
    ),
    PermissionSpec(
        code=DATASET_OVERRIDE,
        name="人工修正点位汇总值",
        kind="admin",
        group_code="dataset",
        group_label="数据台账",
        sort_order=40,
        description=(
            "写入、撤销与按列批量清除人工修正。⚠ 修正值优先于自动采集值，"
            "且采集与重算都绕开它——等同于篡改台账，故与录入分成两个码"
        ),
    ),
    PermissionSpec(
        code=DATASET_BACKFILL,
        name="重算与回填台账",
        kind="admin",
        group_code="dataset",
        group_label="数据台账",
        sort_order=50,
        description=(
            "按时间范围重算公式列、回填历史。⚠ 一次会改写大批历史行并吃满"
            "数据库，与「改一行」不是同一类风险"
        ),
    ),
    PermissionSpec(
        code=FORMULA_VIEW,
        name="查看公式库",
        kind="view",
        group_code="formula",
        group_label="公式库",
        sort_order=10,
        description="公式库列表、详情与引用反查",
    ),
    PermissionSpec(
        code=FORMULA_MANAGE,
        name="管理公式库",
        kind="admin",
        group_code="formula",
        group_label="公式库",
        sort_order=20,
        description=(
            "建改删库公式、停用与恢复出厂口径。⚠ 与「管理数据台账」分家是"
            "刻意的：改一条库公式会同时改掉**所有**引用它的台账列，"
            "停用一条还在被引用的公式会让那些表的录入与重算一起报错"
        ),
    ),
    PermissionSpec(
        code=MODELING_VIEW,
        name="查看分析建模",
        kind="view",
        group_code="modeling",
        group_label="分析建模",
        sort_order=10,
        description=(
            "流水线、运行记录、节点中间结果、模型版本与绑定的全部读面。"
            "⚠ 中间结果里含所取台账的前若干行原始数据——不然「看得到每一步的"
            "结果」这条诉求无从满足"
        ),
    ),
    PermissionSpec(
        code=MODELING_MANAGE,
        name="管理分析流水线",
        kind="manage",
        group_code="modeling",
        group_label="分析建模",
        sort_order=20,
        description="建改删流水线、图校验、导出与导入",
    ),
    PermissionSpec(
        code=MODELING_RUN,
        name="发起分析运行",
        kind="manage",
        group_code="modeling",
        group_label="分析建模",
        sort_order=30,
        description=(
            "发起与取消一次运行。⚠ 与「管理分析流水线」分家：一次训练会吃满"
            "一个 CPU 核，配得了图未必该在业务高峰跑得起来"
        ),
    ),
    PermissionSpec(
        code=MODELING_PUBLISH,
        name="发布模型并接入公式",
        kind="admin",
        group_code="modeling",
        group_label="分析建模",
        sort_order=40,
        description=(
            "把一次成功运行发布成模型版本，并绑定到公式库条目上。"
            "⚠ 与「发起分析运行」分家是刻意的：绑定生效后，引用那条公式的每一"
            "张台账的数值都会跟着模型走，而变化的原因是几千个浮点参数，"
            "没有任何地方 diff 得出来"
        ),
    ),
    PermissionSpec(
        code=KNOWLEDGE_USE,
        name="使用知识库",
        kind="view",
        group_code="knowledge",
        group_label="知识库",
        sort_order=10,
        description="检索、问答、看命中的原文块",
    ),
)

ALL_CODES: frozenset[str] = frozenset(item.code for item in PERMISSIONS)
VIEW_CODES: tuple[str, ...] = tuple(
    item.code for item in PERMISSIONS if item.kind == "view"
)


def grouped_permissions() -> tuple[PermissionGroup, ...]:
    """按 `group_code` 归组，组内按 `sort_order` 升序。"""
    order: list[str] = []
    buckets: dict[str, list[PermissionSpec]] = {}
    for item in PERMISSIONS:
        if item.group_code not in buckets:
            buckets[item.group_code] = []
            order.append(item.group_code)
        buckets[item.group_code].append(item)
    return tuple(
        PermissionGroup(
            code=code,
            label=buckets[code][0].group_label,
            items=tuple(
                sorted(buckets[code], key=lambda spec: spec.sort_order)
            ),
        )
        for code in order
    )
