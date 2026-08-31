"""服务端工具的规格：叫什么、收什么参数、在哪一侧执行。

⚠ 与实现（同目录的 `server.py`）分成两份文件，只因为并成一份会破 600 行的模块
闸。**对外它们是同一个 `ToolProvider`**：`ServerTools.specs()` 交出这一份，
`ServerTools.run()` 按同一批名字分派，两者对不上由契约测试当场拦下——所以「加一个
工具要记得改两处」这件事不再靠人记。

⚠ 这一份里的 `name` / `description` / `parameters` 是**喂给模型的提示词**，
改一个字就是行为改动，不是重构。
"""

from ai_assistant.apps.chat.services.tools.shapes import (
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
                "module_type": string_schema("要展开的模块类型，如 info-card"),
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
