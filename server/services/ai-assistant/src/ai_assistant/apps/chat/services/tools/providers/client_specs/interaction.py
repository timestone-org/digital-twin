"""联动那一批客户端工具的规格：读规则表、写一条、删一条、改初始显隐。

⚠ 与同目录的 `core.py` 同一口径——只有形状，实现在浏览器里；名字必须与
前端工作面的 `tools` 数组逐字相同。对不上时模型看得见那个工具、
调用却每次都失败，而失败的样子与「这一页没实现它」一模一样。

单独一个模块而不是接着往那一份里加：规格文件已经四百多行，而工具还会一直加，
挤在一起的那一天最省事的改法是把新工具塞进别的段落里——名字与实现于是开始漂。
"""

from ai_assistant.apps.chat.services.tools.shapes import (
    ToolSpec,
    object_schema,
    string_schema,
)

INTERACTION_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="dashboard.read_interactions",
        description=(
            "读这一屏的全部**联动规则**（点一下让别处显示 / 隐藏 / 切换、"
            "弹窗、跨屏跳转），外加「哪些画布节点能当触发源、各自发得出"
            "什么事件」。动手之前先读一次。"
            "⚠ 只有 `sources` 里列出的那几个节点能当触发源。别的节点配了"
            "规则也永远不触发——一块纯装饰的图片不上抛任何事件，"
            "而规则照样存得下去、不报错。"
            "⚠ 每条规则带一格 `problems`：非空就是这条现在已经是哑的"
            "（源节点被删了、源发不出那个事件、目标节点被删了）。"
            "用户说「联动不好使」时先看它，不要急着新加一条。"
        ),
        parameters=object_schema({}, []),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.write_interaction",
        description=(
            "写一条联动规则：`rule_id` 给了就改那一条，不给就新建一条。"
            "一条规则 = 「某个画布节点上发生某个事件」→「做一个动作」。"
            "\n`action` 按 `type` 取这几档之一：\n"
            "- `{type:'show'|'hide'|'toggle', targets:[节点id,…]}` "
            "改一组节点的显隐，最常用的一档\n"
            "- `{type:'setActive', groups:[{value, targets:[…]},…]}` "
            "按上抛的值互斥切换：命中的那组显示、其余组隐藏\n"
            "- `{type:'openModal', target:节点id, title?:'标题'}` "
            "把那个节点连同子树浮成弹窗\n"
            "- `{type:'closeModal'}` 关掉当前弹窗\n"
            "- `{type:'navigate', target:大屏id}` 跳到另一张大屏\n"
            "- `{type:'navigateByValue', routes:[{value, target:大屏id},…]}` "
            "按上抛的值分流跳转\n"
            "⚠ 两档跳转的 `target` 是**另一张大屏的 id**，不是画布节点 id——"
            "从 `dashboards.list` 取。填成节点 id 存得下去、也不报错，"
            "点下去只会跳到一张不存在的屏（这一条会当场被拒）。\n"
            "⚠ 弹窗的目标节点要先设成**初始隐藏**（`dashboard.set_visible`），"
            "否则屏上与弹窗里各画一份。\n"
            "⚠ 按值那两档的 `value` 不能留空：不带值的事件一律不派发，"
            "留空的那条永远不命中。\n"
            "⚠ 联动**只改运行时显隐**，不写回节点配置；规则不在撤销栈上，"
            "用户按 Ctrl+Z 退不回来，改完要跟他说一句。"
        ),
        parameters=object_schema(
            {
                "rule_id": string_schema(
                    "要改哪一条；新建就不给。取自 read_interactions"
                ),
                "source_node_id": string_schema(
                    "事件从哪个画布节点发出，须在 read_interactions 的 "
                    "`sources` 里"
                ),
                "event": {
                    "type": "string",
                    "enum": ["click", "change", "select"],
                    "description": (
                        "触发事件；须是源模块发得出的那几个之一"
                        "（见 `sources[].events`）"
                    ),
                },
                "action": {
                    "type": "object",
                    "description": (
                        "做什么，形状按上面列的那几档之一给；`type` 必给"
                    ),
                    "additionalProperties": True,
                },
            },
            ["source_node_id", "event", "action"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.remove_interaction",
        description=(
            "删掉一条联动规则。"
            "⚠ 规则不在撤销栈上，**删之前先用 `user.ask` 让用户点一下确认**。"
            "回执里把整条原样交还，用户反悔就照它再写一次。"
        ),
        parameters=object_schema(
            {"rule_id": string_schema("要删哪一条，取自 read_interactions")},
            ["rule_id"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.set_visible",
        description=(
            "改一个画布节点**保存下来的**初始显隐。"
            "配弹窗与显隐类联动要的另一半：先把那个节点设成初始隐藏，"
            "再让规则在运行时把它显示出来。"
            "⚠ 联动改的是运行时的临时显隐，落库的初始值只有这个工具改得动。"
            "⚠ 隐藏一个容器节点会把它整棵子树一起藏掉。"
        ),
        parameters=object_schema(
            {
                "node_id": string_schema("画布节点 id"),
                "is_visible": {
                    "type": "boolean",
                    "description": "显示给 true，初始隐藏给 false",
                },
            },
            ["node_id", "is_visible"],
        ),
        runs_on="client",
    ),
)
