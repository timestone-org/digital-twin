"""工具规格：一个工具叫什么、收什么参数、**在哪一侧执行**。

⚠ `runs_on` 是这份规格里最要紧的一格。服务端工具在本进程里跑完就有结果；
客户端工具要下发到浏览器、由编辑器执行，回合会在那里停下来等。两者的失败
含义也不同：服务端工具失败是我们的问题，客户端工具失败意味着那一页根本没
实现它——得如实告诉模型别再调（ADR-0023）。

⚠ 规格里**不写实现**。服务端工具的实现按名字在运行时装，客户端工具压根没有
服务端实现——它只需要一份能让模型正确调用的形状描述。
"""

from dataclasses import dataclass
from typing import Any, Literal

ToolSide = Literal["server", "client"]


@dataclass(frozen=True)
class ToolSpec:
    """一个工具的对外形状。`name` 与技能清单里登记的逐字相同。"""

    name: str
    description: str
    # JSON Schema 的 `object` 段。⚠ 每个字段都要写 description：模型只能靠它
    # 判断该填什么，缺了的那一格它会自己编一个看起来合理的值
    parameters: dict[str, Any]
    runs_on: ToolSide


def openai_schema(spec: ToolSpec) -> dict[str, Any]:
    """摊成 OpenAI 兼容端点认的函数声明。

    Args: spec。
    """
    return {
        "type": "function",
        "function": {
            "name": spec.name,
            "description": spec.description,
            "parameters": spec.parameters,
        },
    }


def _object(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


def _string(description: str) -> dict[str, Any]:
    return {"type": "string", "description": description}


def _integer(description: str) -> dict[str, Any]:
    return {"type": "integer", "description": description}


TOOL_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="skills.load",
        description=(
            "取一个技能的完整指令。提示词里只有技能的名字与一句话简介，"
            "**动手之前必须先把要用的那个技能拉全**——简介里没有任何"
            "关于怎么做的约束。"
        ),
        parameters=_object(
            {"name": _string("技能名，取自可用技能清单")}, ["name"]
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="modules.catalog",
        description=(
            "模块清单，**唯一的模块真源**。不给参数时列出全部模块的名片；"
            "给 module_type 时把那一个的配置字段与绑定槽全部展开。"
            "摆模块或改配置之前必须先把那一个展开——"
            "清单里没有的配置键写进去不报错也不生效。"
        ),
        parameters=_object(
            {
                "module_type": _string("要展开的模块类型，如 metric-card"),
                "keyword": _string("按中文名或别名筛名片表；展开时不用给"),
            },
            [],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="points.list_sources",
        description="列出全部采集数据源。绑点之前先看有哪些源。",
        parameters=_object({}, []),
        runs_on="server",
    ),
    ToolSpec(
        name="points.search",
        description=(
            "按关键词找采集点位。关键词会同时对中文名与编码做匹配，"
            "并按单位与数据类型给候选打分。找不到就返回空表，不要猜。"
        ),
        parameters=_object(
            {
                "keyword": _string("要找的东西，如「1号机组出口温度」"),
                "source_id": _string("限定在某个数据源内；不给则全库找"),
                "limit": _integer("最多返回几条，缺省 20，上限 50"),
            },
            ["keyword"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="dashboard.validate",
        description="让服务端自检这张大屏，列出全部悬空引用。绑完点位后调它。",
        parameters=_object(
            {"dashboard_id": _string("大屏 id")}, ["dashboard_id"]
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
        parameters=_object(
            {
                "table_id": _string("台账 id，取自当前工作面"),
                "keyword": _string("按函数名或说明筛，如「同比」「PREV」"),
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
        parameters=_object(
            {
                "table_id": _string("台账 id"),
                "formula": _string("要验的表达式"),
                "column_key": _string("正在编辑的那一列的 key；给了才做环检测"),
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
        parameters=_object(
            {
                "table_id": _string("台账 id"),
                "formula": _string("要试算的表达式"),
                "column_key": _string("正在编辑的那一列的 key"),
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
        name="dataset.read_columns",
        description=(
            "读当前这张台账有哪些列：key、名字、类型、单位、取值来源，"
            "公式列还带着它现在的表达式。动手之前先读一次。"
        ),
        parameters=_object({}, []),
        runs_on="client",
    ),
    ToolSpec(
        name="dataset.propose_formula",
        description=(
            "把写好并验过的表达式**交给用户过目**，由他点确认才落库。"
            "⚠ 台账页没有撤销栈，所以你只提议、不写入。"
        ),
        parameters=_object(
            {
                "column_key": _string("要写给哪一列；新列就给你建议的 key"),
                "formula": _string("表达式"),
                "reading": _string("一句话说明这条公式在算什么"),
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
        parameters=_object({}, []),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.read_bindings",
        description=(
            "读某个画布节点的绑定槽位声明与已有绑定。"
            "数组槽会带上每一行对应的实体名字——按名字对，不要按行号猜。"
        ),
        parameters=_object({"node_id": _string("画布节点 id")}, ["node_id"]),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.write_binding",
        description=(
            "把一个数据来源写进某个槽位。`field_key` 必须是该模块声明过的槽键，"
            "数组槽形如 `itemValues[0].value`；槽位还不存在时会顺手建出来。"
            "接实时点位用 `source_kind='opcua'` 并给 `node_key`；"
            "写一个不随现场变的固定值用 `source_kind='static'` 并给 `value`"
            "（数字、文本、真假都行）。"
        ),
        parameters=_object(
            {
                "node_id": _string("画布节点 id"),
                "field_key": _string("槽键"),
                "source_kind": {
                    "type": "string",
                    "enum": ["opcua", "static"],
                    "description": (
                        "取数来源：opcua = 采集点位，static = 常量。缺省 opcua"
                    ),
                },
                "node_key": _string(
                    "点位身份，形如 `{数据源id}:{点位编码}`；opcua 才要"
                ),
                "value": {
                    "description": "常量值，static 才要。给 null 表示空值",
                },
            },
            ["node_id", "field_key"],
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
        parameters=_object(
            {
                "node_id": _string("画布节点 id"),
                "field_key": _string("槽键"),
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
        ),
        parameters=_object(
            {
                "module_type": _string("模块类型，取自 modules.catalog"),
                "x": _integer("左上角横坐标（设计像素，整数）"),
                "y": _integer("左上角纵坐标（设计像素，整数）"),
                "parent_id": _string("落进哪个容器节点；不给则落到顶层"),
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
        parameters=_object({"node_id": _string("画布节点 id")}, ["node_id"]),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.set_geometry",
        description=(
            "改一个画布节点的位置与大小。只给要改的那几维，"
            "不给的维保持原值。全部必须是整数。"
        ),
        parameters=_object(
            {
                "node_id": _string("画布节点 id"),
                "x": _integer("左上角横坐标"),
                "y": _integer("左上角纵坐标"),
                "w": _integer("宽"),
                "h": _integer("高"),
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
        ),
        parameters=_object(
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
            "⚠ 三维模块在截图里是一块空白，那是截不到不是没配。"
        ),
        parameters=_object({}, []),
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
        parameters=_object({"node_id": _string("画布节点 id")}, ["node_id"]),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.add_config_item",
        description=(
            "往一个**数组配置字段**末尾加一项，新项按模块清单里的 itemSchema "
            "填默认值，再用 `values` 覆盖你要改的那几格。"
            "「给实时数值卡再加一个指标」就是它（field 为 items）。"
            "返回新项的下标，**数据槽的行号与它一致**——加完通常还要为这一行"
            "写绑定，槽键形如 `itemValues[下标].value`。"
        ),
        parameters=_object(
            {
                "node_id": _string("画布节点 id"),
                "field": _string("数组配置字段的键，如 items"),
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
            "⚠ 删中间一项会让它之后每一行的数据绑定都改喂前一项——"
            "删完必须重读绑定并跟用户说清。"
        ),
        parameters=_object(
            {
                "node_id": _string("画布节点 id"),
                "field": _string("数组配置字段的键，如 items"),
                "index": _integer("要删第几项，从 0 起"),
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
        parameters=_object({}, []),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.set_config",
        description=(
            "改一个画布节点的配置。`path` 是配置路径，"
            "外观类改 `__cardStyle` 下面的键"
            "（去掉边框 = borderStyle 设成 none）。"
        ),
        parameters=_object(
            {
                "node_id": _string("画布节点 id"),
                "path": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "配置路径，如 ['__cardStyle','borderStyle']"
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
)


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
