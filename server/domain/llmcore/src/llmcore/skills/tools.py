"""宿主共同使用的技能加载、资源读取与工具契约查询规格。"""

from llmcore.tools.shapes import ToolSpec, object_schema, string_schema

METADATA_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="skills.load",
        description=(
            "取一个技能的完整指令。提示词里只有技能的名字与一句话简介，"
            "**动手之前必须先把要用的那个技能拉全**——简介里没有任何"
            "关于怎么做的约束。这个工具**必须单独调用**，拿到指令"
            "后再决定其它工具调用。"
        ),
        parameters=object_schema(
            {"name": string_schema("技能名，取自可用技能清单")}, ["name"]
        ),
        runs_on="server",
        is_exclusive=True,
    ),
    ToolSpec(
        name="skills.read_resource",
        description=(
            "按需读取技能包内的文本参考、脚本源码或模板；不会执行脚本。先"
            "用 skills.load 取得资源相对路径。输出含 content、行号与 next"
            "_line。"
        ),
        parameters=object_schema(
            {
                "name": string_schema("本轮可用技能的 name"),
                "path": string_schema(
                    "从 skills.load.resources 复制的相对路径"
                ),
                "start_line": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100000,
                    "description": "开始行号，1 起，默认 1",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 200,
                    "description": "最多读取行数，默认 80，上限 200",
                },
            },
            ["name", "path"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="tools.describe",
        description=(
            "查看本轮可用工具的完整输入 JSON Schema、输出含义、副作用和失"
            "败恢复方式；工具参数不确定时先查。"
        ),
        parameters=object_schema(
            {"name": string_schema("本轮工具清单中的规范名，如 skills.load")},
            ["name"],
        ),
        runs_on="server",
    ),
)
