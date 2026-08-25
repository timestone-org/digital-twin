"""提示词装配：常驻的那几百字，加上按需长出来的部分。

**这是整套助手的上下文工程主轴。** 常驻的只有：一段基本约定、当前工作面、
以及每个可用技能的名字与一句话简介。技能的完整指令**不常驻**——模型判断要用
哪个之后，自己调 `skills.load` 把它拉全。

⚠ 为什么不把四个技能的正文全铺进去：一份正文两三千字，四份就把上下文的前
三分之一占掉了，而其中至少三份与这一轮毫无关系。被挤掉的是工作面快照与工具
结果——也就是模型**真正需要看**的那些东西，而挤掉了哪一段从外面完全看不出来。

⚠ 工作面一换，可用技能集跟着变，不适用的技能连名字都不出现。让模型看见一个
它在这一页上根本调不动的技能，只会让它先试一次、失败、再换——三次往返换一个
本可以不发生的错误。
"""

from typing import Any

from ai_assistant.apps.chat.services.surface_context import render
from ai_assistant.apps.chat.skills import SkillManifest, skills_for

# 常驻约定。⚠ 「节点」在本仓指三样东西，这一段必须留着——不说清的话模型会把
# 画布节点、采集点位、地址空间节点混着叫，而用户读不出它在说哪一个
_BASE = """你是这套工业数字孪生平台的助手。

## 说话的规矩

- 说中文，**简短**。面板只有一栏宽，长篇大论要滚很久才看得到结论。
- 正文按 markdown 写：小标题、列表、表格、`行内代码` 都会被渲染出来。
  ⚠ 别用一级标题，也别为一句话的答复套一个标题。
- 「节点」在本系统里指三样东西，一律用全称：**画布节点**（大屏上的一个模块）、
  **点位**（采集来的一个测点）、**地址空间节点**（OPC UA 服务器里的）。
- 不确定就问，不要猜着做。做错一步的代价远大于多问一句。
- 每次只做用户要的那件事，不要顺手改别的。
- 用户说「这个」「当前这个模块」时，指的是**下面快照里选中的那一个**；
  快照说没有选中，就问一句是哪一个，不要挑一个看着像的。

## 动手的规矩

- 你在大屏与孪生编辑器上的改动**落在用户的草稿里**，他随时能撤销，
  但**保存永远由他自己按**——你不替他保存。
- 其余页面（台账、采集）**没有撤销**，每一次写入都是真实落库。
  在那里你只提议，由用户确认。
- 工具失败时如实说失败了，不要装作做成了。
"""

_NO_SKILLS = "这一页上没有可用的技能，你只能解读与回答问题。"


def build_system_prompt(
    surface_kind: str,
    *,
    surface_label: str = "",
    context: dict[str, Any] | None = None,
) -> str:
    """装配常驻提示词。

    ⚠ 工作面快照排在**技能名录之前**：模型读到「用户选中的是这一个」之后再
    读技能，选技能这一步才有依据。反过来的话它常常先挑好技能才发现自己没弄清
    对象，于是多一次往返。

    Args: surface_kind, surface_label（给人看的页面名，缺省用工作面标识）,
        context（工作面此刻的摘要，前端每次推进都带最新的一份）。
    """
    skills = skills_for(surface_kind)
    where = surface_label or surface_kind
    parts = [
        _BASE.strip(),
        f"## 当前位置\n\n用户正在**{where}**。",
        render(context),
        _roster(skills),
    ]
    return "\n\n".join(one for one in parts if one)


def _roster(skills: tuple[SkillManifest, ...]) -> str:
    """技能花名册：只有名字与一句话。

    Args: skills。
    """
    if not skills:
        return f"## 可用技能\n\n{_NO_SKILLS}"
    lines = [f"- `{skill.name}` —— {skill.summary}" for skill in skills]
    return "\n".join(
        [
            "## 可用技能",
            "",
            *lines,
            "",
            "⚠ 上面只是简介，**里面没有任何关于怎么做的约束**。",
            "动手之前先用 `skills.load` 把要用的那个技能拉全，照它说的做。",
        ]
    )
