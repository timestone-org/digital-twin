"""客户端工具的规格：由浏览器里那一页执行的那一批。

⚠ 前端各工作面的 `tools` 数组必须与这里**逐字相同**（AI_ASSISTANT_V3_PLAN §2）：
对不上时模型看得见那个工具、调用却每次都失败，而失败的样子与「这一页没实现它」
一模一样。

⚠ 这里只有形状，没有实现——客户端工具在服务端压根没有实现。
"""

from ai_assistant.apps.chat.services.tools.providers.client_specs import history
from ai_assistant.apps.chat.services.tools.providers.client_specs.reads import (
    binding_read_parameters,
)
from llmcore.tools.shapes import (
    ToolSpec,
    integer_schema,
    object_schema,
    string_schema,
)

CLIENT_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="dashboard.list_nodes",
        description="大屏节点名片分页；摘要未列全时按keyword或selected_only筛选，沿next_offset续读。每页最多20个。",
        parameters=object_schema(
            {
                "keyword": string_schema("节点名称、id或模块类型"),
                "selected_only": {
                    "type": "boolean",
                    "description": "只列用户已选中的节点，默认false",
                },
                "offset": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "首次0，随后使用next_offset",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "description": "每页条数，默认20",
                },
            },
            [],
        ),
        runs_on="client",
    ),
    # 内建：不归任何技能，只要这一页报了它就下发（见 `tool_select`）
    ToolSpec(
        name="user.ask",
        description=(
            "要用户拿主意时问他：问题与选项在页面上渲染成一排可点的按钮，"
            "回执是 `{picked, free_text, is_cancelled}`。"
            "⚠ `options` **必给**、2–6 个，且要互斥地穷尽这一步的分叉，"
            "最可能的那个排第一。真正开放的问题（起个名字、填一个数）用 "
            "`allow_free_text: true`，**但仍然要给几个常见候选**："
            "给了候选，八成的情况用户点一下就过去了。"
            "⚠ 用户不回答时回的是 `is_cancelled: true`，那是一条**正常回执**"
            "而不是失败：换个方式往下走，别去排查「工具坏了」。"
            "⚠ **必须单独成一批**：这一次调用里除了它不许有别的工具。"
            "混着发出去时，后面那几个动作按顺序照跑，于是用户点了「取消」"
            "而覆盖照样发生了——「哪个选项算取消」只有你知道，页面读不出来。"
        ),
        parameters=object_schema(
            {
                "question": string_schema("一句话问题，一次只问一件事"),
                "options": {
                    "type": "array",
                    "description": "备选项，2–6 个，最可能的排第一个",
                    "items": {
                        "type": "object",
                        "properties": {
                            "value": string_schema("这一项的取值，回执按它认"),
                            "label": string_schema("按钮上的字，一行以内"),
                            "hint": string_schema(
                                "补一句这一项意味着什么，可省"
                            ),
                        },
                        "required": ["value", "label"],
                        "additionalProperties": False,
                    },
                },
                "allow_multiple": {
                    "type": "boolean",
                    "description": "允许多选，缺省 false",
                },
                "allow_free_text": {
                    "type": "boolean",
                    "description": (
                        "除选项外再给一个输入框，缺省 false；给了也仍然要给选项"
                    ),
                },
                "free_text_label": string_schema(
                    "输入框的提示语；allow_free_text 为真时才有用"
                ),
            },
            ["question", "options"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dataset.read_columns",
        description=(
            "读当前这张台账有哪些列：key、名字、类型、单位、取值来源，"
            "公式列还带着它现在的表达式。动手之前先读一次。"
        ),
        parameters=object_schema({}, []),
        runs_on="client",
    ),
    ToolSpec(
        name="dataset.propose_formula",
        description=(
            "把写好并验过的表达式**交给用户过目**，由他点确认才落库。"
            "⚠ 台账页没有撤销栈，所以你只提议、不写入。"
        ),
        parameters=object_schema(
            {
                "column_key": string_schema(
                    "要写给哪一列；新列就给你建议的 key"
                ),
                "formula": string_schema("表达式"),
                "reading": string_schema("一句话说明这条公式在算什么"),
            },
            ["column_key", "formula", "reading"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.read_canvas",
        description=(
            "读当前画布：有哪些画布节点、各是什么模块、摆在哪、叫什么。"
            "动手之前先读一次。"
        ),
        parameters=object_schema({}, []),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.read_bindings",
        description=(
            "读某个画布节点的绑定槽位声明，以及**每一行此刻喂的是谁**。"
            "数组槽摊成行，每行带 `entity`（这一行喂的那个实体的人话名字："
            "孪生是「信息板名 · 字段名」，实时数值卡是指标名）与 `node_key`。"
            "**按 `entity` 的名字对，不要按行号猜。**"
            "⚠ 还没绑的行也会出现、`node_key` 为 null——那不是这一行不存在，"
            "是它还空着。"
            "⚠ `node_key` 只是身份串，看不出是哪个点位：要核对已绑的对不对，"
            "把它们收一批交给 `points.resolve` 换成名字。"
            "支持 slot_key、entity_id、keyword 筛选；"
            "按实体读取时先查到真实 id。"
            "每次默认及最多 20 行，offset 从 0 起。has_more=true 时保持筛选，"
            "把 next_offset 原样作为 offset 继续，直到目标读完；"
            "is_truncated 仅表示还有后续页，不能因此停止绑定。"
            "实际 returned 可能小于 limit，续读以 next_offset 为准。"
        ),
        parameters=object_schema(
            {
                "node_id": string_schema("画布节点 id"),
                **binding_read_parameters(),
            },
            ["node_id"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.write_binding",
        description=(
            "把一个数据来源写进某个槽位。`field_key` 必须是该模块声明过的槽键，"
            "数组槽形如 `itemValues[0].value`；槽位还不存在时会顺手建出来。"
            "接实时点位用 `source_kind='opcua'` 并给 `node_key`；"
            "写一个不随现场变的固定值用 `source_kind='static'` 并给 `value`"
            "（数字、文本、真假都行）。大屏编辑器的时序槽用 archive + node_key "
            "或 dataset + dataset_key，并必须给 range；"
            "孪生子编辑器仍只接实时和常量。"
            "⚠ 绑完要 `dashboard.save` 才会有实时数：推送计划按**已落库**的"
            "绑定组装，草稿里的绑定它看不见。"
        ),
        parameters=object_schema(
            {
                "node_id": string_schema("画布节点 id"),
                "field_key": string_schema("槽键"),
                "source_kind": {
                    "type": "string",
                    "enum": ["opcua", "static", "archive", "dataset"],
                    "description": (
                        "opcua 实时，static 常量；大屏时序槽还支持 "
                        "archive 归档、dataset 台账。缺省 opcua"
                    ),
                },
                "node_key": string_schema(
                    "点位身份，形如 `{数据源id}:{点位编码}`；opcua 才要"
                ),
                "value": {
                    "description": "常量值，static 才要，不能是 null",
                },
                **history.history_parameters(),
            },
            ["node_id", "field_key"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.save",
        description=(
            "把当前草稿整份保存落库。**新绑的点位要保存之后才会有实时数**"
            "——推送方读的是已落库的绑定计划，编辑器草稿里的绑定它看不见，"
            "用户明确要求保存时也可按授权调用。"
            "⚠ 它保存的是**整份草稿**，连用户自己刚改还没保存的那些一起落库；"
            "第一次调之前先跟用户说一句。"
            "⚠ 保存失败（尤其是 409：别人动过这张屏）就**停下来**报给用户，"
            "别接着往下绑——那之后每一条都存不进去。"
        ),
        parameters=object_schema({}, []),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.read_values",
        description=(
            "读此刻画面上的实时读数，与画布渲染的是同一份数。"
            "给 node_id 就只读那一个画布节点，不给则读整屏。"
            "按实体、槽位或关键词筛选，每页最多20行；沿next_offset续读。"
            "value 是变换后的显示值，raw_value 保留原值，quality 表明质量。"
            "status：has_value 有有效值、uncertain 质量不确定、"
            "waiting 尚无样本、"
            "empty 无数据、unavailable 取数失败或质量不合格、"
            "`unbound` 还没绑。"
            "大屏历史槽还返回 series：点数、实际起止时刻、截断方向与陈旧标记。"
            "⚠ `waiting` **不等于**点位坏了：刚 `dashboard.save` 完就读，"
            "多半全是 waiting。等一下再读一次，不要据此去改绑定。"
        ),
        parameters=object_schema(
            {
                "node_id": {
                    "type": ["string", "null"],
                    "description": (
                        "画布节点 id；省略、null或空字符串"
                        "均读整屏（或当前孪生）"
                    ),
                },
                **binding_read_parameters(),
            },
            [],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.copy_bindings",
        description=(
            "把一处已经接好的整套**取数来源**照抄到另一处："
            "「1 号机组接好了，2 号机组照着接」。"
            "两组参数**只给一组**：大屏画布节点之间给 from_node_id 与 "
            "to_node_id，同一段孪生内的实体之间给 from_entity_id 与 "
            "to_entity_id。"
            "⚠ 抄的只是取数来源，标题、单位、阈值这些配置一概不动"
            "（那些归 `dashboard.set_config`）——否则 2 号机组会连标题"
            "一起变成「1 号机组…」。"
            "⚠ 先用 `dry_run: true` 把匹配结果拿给用户过目再落地。"
            "缺省的 `by_label` 按行的实体名字对，对不上的行进 `skipped`；"
            "**不要改用 `by_index` 硬抄**——按行号对齐正是「每条都有值、"
            "全接错对象」的来源，如实把匹配不上的报出来。"
        ),
        parameters=object_schema(
            {
                "from_node_id": string_schema(
                    "抄自哪个画布节点；大屏画布节点之间用这一组"
                ),
                "to_node_id": string_schema("抄到哪个画布节点"),
                "from_entity_id": string_schema(
                    "抄自哪个实体（孪生的信息板 / 锚点 / 部件）"
                ),
                "to_entity_id": string_schema("抄到哪个实体"),
                "match": {
                    "type": "string",
                    "enum": ["by_label", "by_index"],
                    "description": (
                        "行怎么对上：by_label 按实体名字（缺省）、"
                        "by_index 按行号"
                    ),
                },
                "dry_run": {
                    "type": "boolean",
                    "description": "只看匹配结果不落地，缺省 false",
                },
            },
            [],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.remove_binding",
        description=(
            "解掉某个槽位上的绑定。⚠ 换点位不要用它——直接再写一次 "
            "`dashboard.write_binding` 即可；解了再绑会让实时推送的"
            "关联键断一次。"
        ),
        parameters=object_schema(
            {
                "node_id": string_schema("画布节点 id"),
                "field_key": string_schema("槽键"),
            },
            ["node_id", "field_key"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.add_module",
        description=(
            "往画布上加一个模块。`module_type` 取自模块清单。"
            "不给坐标就落到默认位置。返回新节点的 id。"
            "⚠ 清单里带 `region` 的（页头 / 页脚）是**钉位单例**："
            "每屏最多一个、只能落顶层、坐标由钉边算，"
            "给的 x/y/parent_id 一律不作数。"
        ),
        parameters=object_schema(
            {
                "module_type": string_schema("模块类型，取自 modules.catalog"),
                "x": integer_schema("左上角横坐标（设计像素，整数）"),
                "y": integer_schema("左上角纵坐标（设计像素，整数）"),
                "parent_id": string_schema("落进哪个容器节点；不给则落到顶层"),
            },
            ["module_type"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.remove_node",
        description=(
            "删掉一个画布节点。⚠ **连它的子树一起删**。"
            "删之前先告诉用户要删什么、有几个子节点。"
        ),
        parameters=object_schema(
            {"node_id": string_schema("画布节点 id")}, ["node_id"]
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.set_geometry",
        description=(
            "改一个画布节点的位置与大小。只给要改的那几维，"
            "不给的维保持原值。全部必须是整数。"
            "⚠ 钉位模块（清单里带 `region` 的页头 / 页脚）横向恒铺满、"
            "钉住的那条边不动，**只有高度改得动**：页头钉上沿、页脚钉下沿，"
            "y 由钉边与高算出来。回执报的是落库后的几何，以它为准。"
        ),
        parameters=object_schema(
            {
                "node_id": string_schema("画布节点 id"),
                "x": integer_schema("左上角横坐标"),
                "y": integer_schema("左上角纵坐标"),
                "w": integer_schema("宽"),
                "h": integer_schema("高"),
            },
            ["node_id"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.arrange",
        description=(
            "对齐、分布或整理。对齐要 ≥2 个节点、分布要 ≥3 个，"
            "且它们必须在同一个父层里。tidy 不看 node_ids，整理整个顶层。"
            "⚠ 钉位模块（页头 / 页脚）一律不参与——它们挪不动，"
            "选中集里有它也只按其余节点算个数。"
        ),
        parameters=object_schema(
            {
                "action": {
                    "type": "string",
                    "enum": [
                        "left",
                        "hcenter",
                        "right",
                        "top",
                        "vcenter",
                        "bottom",
                        "distribute-x",
                        "distribute-y",
                        "tidy",
                    ],
                    "description": "做哪一个动作",
                },
                "node_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "参与的画布节点 id",
                },
            },
            ["action"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.capture",
        description=(
            "截当前画布的图并直接看它。**只在这一轮看得见**——"
            "看完必须当场把结论写成文字，下一轮只剩一句「这里曾经有一张图」。"
            "三维（孪生）模块也截得到；若某块 3D 区域仍是空白，"
            "那是那一个场景截取失败，不是没配。"
        ),
        parameters=object_schema({}, []),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.read_config",
        description=(
            "读一个画布节点**此刻的配置**：配置袋子里现有的键值、卡片外观那一段"
            "（`__cardStyle`）、以及这个模块吃不吃统一外观。"
            "⚠ 改配置之前必须先读一次——尤其是往数组字段里加项时，"
            "不读就写等于把用户已经配好的那几项整批冲掉。"
        ),
        parameters=object_schema(
            {"node_id": string_schema("画布节点 id")}, ["node_id"]
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.add_config_item",
        description=(
            "往一个**数组配置字段**末尾加一项，新项按模块清单里的 itemSchema "
            "填默认值，再用 `values` 覆盖你要改的那几格。"
            "field 来自当前模块清单。返回配置项下标；"
            "配置数组不一定对应数据行，"
            "新增后用 dashboard.read_bindings 查询实际实体与槽键再绑定。"
        ),
        parameters=object_schema(
            {
                "node_id": string_schema("画布节点 id"),
                "field": string_schema("数组配置字段的键，如 items"),
                "values": {
                    "type": "object",
                    "additionalProperties": True,
                    "description": (
                        '这一项要设的字段，如 {"label":"出口温度","unit":"°C"}'
                    ),
                },
            },
            ["node_id", "field"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.remove_config_item",
        description=(
            "删掉一个数组配置字段里的第 index 项。"
            "会改变已有绑定所指实体时，工具在写入前拒绝。"
            "先读取受影响绑定，在已确认范围内处理，再重新读取验证。"
        ),
        parameters=object_schema(
            {
                "node_id": string_schema("画布节点 id"),
                "field": string_schema("数组配置字段的键，如 items"),
                "index": integer_schema("要删第几项，从 0 起"),
            },
            ["node_id", "field", "index"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.chrome_keys",
        description=(
            "卡片外观（边框、圆角、背景、标题条、四角、悬停）的**全部可用键**"
            "与各自的合法取值。用户说到外观而你拿不准键名时调它——"
            "外观键不在模块的配置字段里，凭印象写的键存得下去但看不见。"
        ),
        parameters=object_schema({}, []),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.set_config",
        description=(
            "改一个画布节点的配置。`path` 是配置路径，"
            "外观类改 `__cardStyle` 下面的键"
            "（去掉边框 = borderStyle 设成 none）。"
        ),
        parameters=object_schema(
            {
                "node_id": string_schema("画布节点 id"),
                "path": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "integer", "minimum": 0},
                        ]
                    },
                    "description": (
                        "字段用字符串，数组下标用非负整数；"
                        "如 ['indicators',0,'name']"
                    ),
                },
                "value": {
                    "description": "要写的值；给 null 表示删掉这个键",
                },
            },
            ["node_id", "path", "value"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.apply_style",
        description=(
            "把**一整套观感**一次套到一个画布节点上，一次调用、用户一步撤销。"
            "一整套观感的起手取值可以从 modules.catalog 的 preset 取，"
            "也可以自己拼。"
            "⚠ 别用 set_config 逐键去凑：一套外壳 40 个键就是 40 次调用，"
            "中途断在半路，画面停在半套样式上，看着像配错了。"
            "⚠ 外壳是**整袋替换**：这套没写的外壳键会被清掉，回落平台默认。"
            "这正是要的——逐键合并会把上一套的残留留在屏上。"
            "⚠ 内芯只能套回同类型的节点：样式绑了模块类型时，"
            "套到别的类型上会被拒（那些键在那个模块里根本不存在）。"
            "只想套外壳基调就把 config 留空。"
        ),
        parameters=object_schema(
            {
                "node_id": string_schema("画布节点 id"),
                "chrome": {
                    "type": "object",
                    "description": (
                        "外壳整袋，键取自 dashboard.chrome_keys；"
                        "给空对象表示回落平台默认外观"
                    ),
                    "additionalProperties": True,
                },
                "config": {
                    "type": "object",
                    "description": (
                        "内芯，逐键覆盖节点配置；只套外壳时省略或给空对象"
                    ),
                    "additionalProperties": True,
                },
            },
            ["node_id", "chrome"],
        ),
        runs_on="client",
    ),
)
