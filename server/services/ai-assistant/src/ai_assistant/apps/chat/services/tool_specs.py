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
            "把一个采集点位写进某个槽位。`field_key` 必须是该模块声明过的槽键，"
            "数组槽形如 `itemValues[0].value`。"
        ),
        parameters=_object(
            {
                "node_id": _string("画布节点 id"),
                "field_key": _string("槽键"),
                "node_key": _string("点位身份，形如 `{数据源id}:{点位编码}`"),
            },
            ["node_id", "field_key", "node_key"],
        ),
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
