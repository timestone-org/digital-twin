"""工具规格：一个工具叫什么、收什么参数、**在哪一侧执行**。

这一份是服务端工具——在本进程里跑完就有结果，实现按名字在
`services/server_tools.py` 里装。客户端那一批在 `client_tool_specs.py`。
`TOOL_SPECS` 把两侧并成一张表，技能清单与提示词都按它取。
"""

from ai_assistant.apps.chat.services.client_tool_specs import CLIENT_SPECS
from ai_assistant.apps.chat.services.tool_shapes import (
    ToolSpec,
    integer_schema,
    object_schema,
    string_array_schema,
    string_schema,
)

SERVER_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="skills.load",
        description=(
            "取一个技能的完整指令。提示词里只有技能的名字与一句话简介，"
            "**动手之前必须先把要用的那个技能拉全**——简介里没有任何"
            "关于怎么做的约束。"
        ),
        parameters=object_schema(
            {"name": string_schema("技能名，取自可用技能清单")}, ["name"]
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="plan.write",
        description=(
            "写下（或整份重写）这次任务的执行计划。需要 3 步以上或跨多个"
            "对象的任务，**先立计划再动手**；每完成一项立刻把它的 status "
            "改掉再整份重写一次。status 取 pending/in_progress/done/"
            "skipped/failed，同一时刻至多一项 in_progress。全部项走完，"
            "计划自动完结。单步小事不要立计划。"
        ),
        parameters=object_schema(
            {
                "title": string_schema("计划标题：一句话说明这次要做成什么"),
                "items": {
                    "type": "array",
                    "description": "计划项，按执行顺序，整份给全",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": string_schema(
                                "这一项要做什么，具体到能验收"
                            ),
                            "status": {
                                "type": "string",
                                "enum": [
                                    "pending",
                                    "in_progress",
                                    "done",
                                    "skipped",
                                    "failed",
                                ],
                                "description": "状态，缺省 pending",
                            },
                            "note": string_schema("补充说明或失败原因，可省"),
                        },
                        "required": ["title"],
                        "additionalProperties": False,
                    },
                },
            },
            ["items"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="modules.catalog",
        description=(
            "模块清单，**唯一的模块真源**。不给参数时列出全部模块的名片；"
            "给 module_type 时把那一个展开——配置字段全表、绑定槽、"
            "每一档字段类型该写什么形状的值（field_types 图例）、"
            "出厂配置与现成观感预设的目录。"
            "摆模块或改配置之前必须先把那一个展开——"
            "清单里没有的配置键、或形状不对的值，写进去不报错也不生效。"
            "要套某一套预设，再带 preset=<id> 调一次拿它的完整配置。"
        ),
        parameters=object_schema(
            {
                "module_type": string_schema(
                    "要展开的模块类型，如 metric-card"
                ),
                "keyword": string_schema(
                    "按中文名或别名筛名片表；展开时不用给"
                ),
                "preset": string_schema(
                    "要哪一套预设的完整配置，取自展开结果里的 presets[].id；"
                    "与 module_type 同时给"
                ),
            },
            [],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="points.list_sources",
        description="列出全部采集数据源。绑点之前先看有哪些源。",
        parameters=object_schema({}, []),
        runs_on="server",
    ),
    ToolSpec(
        name="points.search",
        description=(
            "按关键词找采集点位。关键词会同时对中文名与编码做匹配，"
            "并按单位与数据类型给候选打分。找不到就返回空表，不要猜。"
        ),
        parameters=object_schema(
            {
                "keyword": string_schema("要找的东西，如「1号机组出口温度」"),
                "source_id": string_schema("限定在某个数据源内；不给则全库找"),
                "limit": integer_schema("最多返回几条，缺省 20，上限 50"),
            },
            ["keyword"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="points.detail",
        description=(
            "按 node_key 取一个点位的完整配置：名字、单位、数据类型、寻址串、"
            "采样周期与归档设置。node_key 形如 `{数据源id}:{点位编码}`，"
            "与绑定里存的是同一个串。回 `point: null` 就是真的没有这个点位"
            "——多半是 node_key 记岔了，用 points.search 重找，不要猜一个。"
        ),
        parameters=object_schema(
            {
                "node_key": string_schema(
                    "点位身份，形如 `{数据源id}:{点位编码}`"
                ),
            },
            ["node_key"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="points.resolve",
        description=(
            "把一批 `node_key` 批量换成人话：名字、编码、单位、数据类型、"
            "所属数据源。**核对「这一行到底绑的是哪个点位」用它**——"
            "读绑定拿到的只是一串身份，光看串认不出绑没绑对。"
            "⚠ 一次最多 50 个，多给的会被截掉并在 `note` 里说出来。"
            "⚠ 认不出的进 `unknown`，不会给一条看着正常的空记录："
            "出现在 `unknown` 里就是这一行绑了一个库里**没有**的点位，"
            "如实报给用户，别当成「有这个点位、只是没名字」。"
        ),
        parameters=object_schema(
            {
                "node_keys": string_array_schema(
                    "要认的点位身份，一次最多 50 个",
                    "点位身份，形如 `{数据源id}:{点位编码}`",
                )
            },
            ["node_keys"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="assets.search",
        description=(
            "按关键词与类型搜素材库（三维模型、图片、图标），"
            "回 id、名字、类型与压缩档，新的在前。都不给就列最新的一批。"
            "空表就是真的没有这个素材，不要编一个 id 或 ref。"
        ),
        parameters=object_schema(
            {
                "keyword": string_schema("按素材名模糊搜"),
                "kind": string_schema(
                    "素材类型：model（三维模型）/ image（图片）/ icon（图标）；"
                    "不给则全类型找"
                ),
                "limit": integer_schema("最多返回几条，缺省与上限都是 20"),
            },
            [],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="dashboards.list",
        description=(
            "列出当前用户可见的大屏：id、名字、所属项目与更新时间。"
            "要检查或说起某张大屏而手上没有 id 时先调它。"
            "空表就是真的一张都没有，不要编一个 id。"
        ),
        parameters=object_schema(
            {
                "keyword": string_schema("按大屏名字模糊筛"),
                "project_id": string_schema("限定在某个项目内；不给则全部"),
                "limit": integer_schema("最多返回几条，缺省与上限都是 20"),
            },
            [],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="dashboard.validate",
        description="让服务端自检这张大屏，列出全部悬空引用。绑完点位后调它。",
        parameters=object_schema(
            {"dashboard_id": string_schema("大屏 id")}, ["dashboard_id"]
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="styles.list",
        description=(
            "卡片样式库：用户自己存下来的**整套观感**，全站共享。"
            "只给 id / 名字 / 一句话 / 绑的模块类型，不带取值。"
            "用户说「换个样子」「好看点」「跟那张屏一样」时**先调它**——"
            "一套外壳有 40 个键，逐个字段凑既慢又必然凑不全，"
            "而库里多半已经有一条现成的。"
            "module_type 为空的是通用外壳样式，套到任何模块上都只写外壳；"
            "非空的连内芯一起，只能套回同类型的节点。"
            "要某一条的完整取值再用 styles.get。"
        ),
        parameters=object_schema(
            {
                "module_type": string_schema(
                    "只列绑这个模块类型的那一组，如 info-card。"
                    "⚠ 通用外壳样式不在其中，两样都要看就别给这一格"
                )
            },
            [],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="styles.get",
        description=(
            "展开一条样式：外壳 `chrome`（写进节点的 `__cardStyle`）与内芯 "
            "`config`（这个模块自己的观感键）的完整取值。"
            "style_id 取自 styles.list，**不要猜一个**——猜的那个回的是一次"
            "调用失败，而那与「这一条样式不存在」看着一模一样。"
            "⚠ 外壳的语义是「键不存在 = 没设置」：套的时候，节点上有、而这套"
            "样式里没有的外壳键要写 null 删掉，留着就是上一套样式的残留。"
        ),
        parameters=object_schema(
            {"style_id": string_schema("样式 id，取自 styles.list")},
            ["style_id"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="styles.save",
        description=(
            "把一整套观感存进样式库（全站共享），或改一条已有的——"
            "给了 style_id 就是改那一条，不给就是新建。"
            "调好一套用户满意的观感之后存一条，下次直接套。"
            "⚠ 存的是**观感**：标题、行/项列表、缺值占位、阈值规则这些内容键"
            "一个都不许写进去。它们跟着数据走不跟着样子走，混进样式里，"
            "别人套用时他配好的格与阈值会被整片抹掉，而两侧都不报错。"
            "⚠ chrome 是**整袋替换**：套用时它就是全部，没写进去的键"
            "在别人那儿会被删成「未设置」。所以要么写全，要么别改这一袋"
            "（改一条已有样式时不给 chrome，那一袋就原样不动）。"
            "⚠ 不给 module_type 就是通用外壳样式，那一档不许带 config。"
            "⚠ 改一条已有样式时**不要给 module_type**：类型改不了，"
            "要换类型就不给 style_id、新建一条。"
            "存之前先 styles.list 看有没有该改的那一条，"
            "别每调一次观感就存一条新的。"
        ),
        parameters=object_schema(
            {
                "name": string_schema(
                    "样式名，人看得懂的一句，如「暗金报表风」"
                ),
                "description": string_schema(
                    "一句话说清它长什么样、什么时候用；"
                    "用户在样式列表里看到的就是这句"
                ),
                "module_type": string_schema(
                    "绑哪个模块类型，如 info-card；"
                    "不给就是通用外壳样式（那时不许给 config）。"
                    "只在新建时给，改一条已有样式时不许给"
                ),
                "chrome": {
                    "type": "object",
                    "additionalProperties": True,
                    "description": (
                        "外壳取值，键取自 dashboard.chrome_keys，"
                        '如 {"borderStyle": "none", "radius": 4}。'
                        "新建时必给（除非这一条只有内芯）"
                    ),
                },
                "config": {
                    "type": "object",
                    "additionalProperties": True,
                    "description": (
                        "内芯取值：这个模块 config_schema 里的**观感键**，"
                        "键名从 modules.catalog 展开结果里取；"
                        "内容键一个都不许放进来"
                    ),
                },
                "style_id": string_schema(
                    "要改的那一条的 id；不给就是新建一条"
                ),
            },
            ["name"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="styles.delete",
        description=(
            "从样式库里删一条。⚠ 样式库全站共享：删了别人也没有了，"
            "动手之前先跟用户确认这一条确实是他要删的那一条。"
            "已经套用过它的节点不受影响——套用是把取值抄进节点，不是引用。"
        ),
        parameters=object_schema(
            {"style_id": string_schema("样式 id，取自 styles.list")},
            ["style_id"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="formula.catalog",
        description=(
            "公式的**唯一函数真源**：函数、运算符、时间窗写法、九条求值口径、"
            "这张台账可引用的列与跨表、公式库条目。不给 keyword 时函数只给"
            "名字与签名；给了才回匹配的那几个并带上样例。"
            "目录里没有的函数写出来是「未知函数」，不要凭记忆写。"
        ),
        parameters=object_schema(
            {
                "table_id": string_schema("台账 id，取自当前工作面"),
                "keyword": string_schema(
                    "按函数名或说明筛，如「同比」「PREV」"
                ),
            },
            ["table_id"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="formula.validate",
        description=(
            "验一条公式的语法、依赖与环。⚠ 写错回的是 `is_ok=false` 加一句"
            "错误说明，不是调用失败——把那句话念给用户听。"
        ),
        parameters=object_schema(
            {
                "table_id": string_schema("台账 id"),
                "formula": string_schema("要验的表达式"),
                "column_key": string_schema(
                    "正在编辑的那一列的 key；给了才做环检测"
                ),
            },
            ["table_id", "formula"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="formula.preview",
        description=(
            "用一组**你自己编的**样例值试算。它不读台账里的真数据，空表也能验。"
            "看返回的 value 是不是你预期的那个数；`history_refs` 列出的那些引用"
            "试算时一律按空算，有这一项时要跟用户明说。"
        ),
        parameters=object_schema(
            {
                "table_id": string_schema("台账 id"),
                "formula": string_schema("要试算的表达式"),
                "column_key": string_schema("正在编辑的那一列的 key"),
                "values": {
                    "type": "object",
                    "additionalProperties": True,
                    "description": '样例值，键是列 key，如 {"本期": 120}',
                },
            },
            ["table_id", "formula"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="datasets.list_tables",
        description=(
            "列出数据台账表：id、编码、名字、采集方式与周期。"
            "任何工作面都能查，说起某张台账而手上没有 id 时先调它。"
            "空表就是真的没有台账，不要编一个 id。"
        ),
        parameters=object_schema(
            {
                "keyword": string_schema("按台账名称或编码模糊筛"),
                "limit": integer_schema("最多返回几条，缺省与上限都是 20"),
            },
            [],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="datasets.read_columns",
        description=(
            "读某张台账**已保存**的列清单：key、名字、类型、单位、来源，"
            "公式列带表达式。⚠ 与 `dataset.read_columns`（单数前缀）不是"
            "同一个：那个读的是台账页上正在编辑的草稿、只在台账工作面可用；"
            "这一个读的是库里已保存的列，任何页面都能查。"
            "table_id 取自 datasets.list_tables。"
        ),
        parameters=object_schema(
            {"table_id": string_schema("台账 id")}, ["table_id"]
        ),
        runs_on="server",
    ),
)

# 两侧并成一张表。⚠ 名字在全表内唯一：重名的那一个会被 `spec_of` 遮掉，
# 而遮掉的是哪一个从外面看不出来
TOOL_SPECS: tuple[ToolSpec, ...] = SERVER_SPECS + CLIENT_SPECS


def spec_of(name: str) -> ToolSpec | None:
    """按名字找规格；没有就给 None。

    Args: name。
    """
    return next((spec for spec in TOOL_SPECS if spec.name == name), None)


def specs_named(names: tuple[str, ...]) -> tuple[ToolSpec, ...]:
    """按名字取一组规格，认不出的名字直接跳过。

    ⚠ 跳过而不是抛：技能清单里可能声明了本期还没实现的工具，那时的正解是
    「模型看不见它」，而不是整个服务起不来。

    Args: names。
    """
    found = (spec_of(name) for name in names)
    return tuple(spec for spec in found if spec is not None)
