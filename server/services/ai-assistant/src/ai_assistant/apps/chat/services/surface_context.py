"""工作面快照进提示词：助手此刻**看得见**用户那一屏是什么样。

⚠ 存在的理由是一句用户每天都在说的话：「把**这个**模块的标题改掉」。
没有快照时，「这个」在模型手里没有指代——它只能反问，或者挑一个看着像的
画布节点动手，而后者是这套东西最容易失去信任的地方。

⚠ 选中项**单拎出来说一遍**，不能只让它躺在 JSON 里的一个 `selected_id`。
埋在几十个节点中间的一格 id，模型十次里有三次读不出「用户指的是它」，
而那三次它会去改另一个。

⚠ 快照有长度上限，超了**明说截断了**。悄悄截断的话，模型会把「我看到的
就是全部」当成事实，然后对着半屏画布下「这一屏没有温度卡」这种结论。
"""

import json
from typing import Any, cast

# 快照进提示词的字符上限。⚠ 有上限：一屏两千个画布节点的整份摘要能有十几万字，
# 而被它挤出去的正是技能正文与工具结果
MAX_CONTEXT_CHARS = 6000

# 选中项在快照里的两个键。与前端 `AiSurface.snapshot()` 逐字对齐
SELECTED_ID_KEY = "selected_id"
SELECTED_KEY = "selected"

_HEADING = "## 这一页此刻的样子"

_NOTE = (
    "上面是这一屏的**摘要**，够你认出用户说的是哪一个；"
    "要看全部画布节点、槽位或配置，用对应的读取工具再拉一次。"
)

_TRUNCATED = "⚠ 快照太长，只给了前面一截——别把它当成这一屏的全部。"


def render(context: dict[str, Any] | None) -> str:
    """把一份工作面快照摊成提示词里的一段；没有快照就是空串。

    Args: context。
    """
    if not context:
        return ""
    body = _dump(context)
    parts = [_HEADING, "", _selected_line(context), "```json", body, "```"]
    if len(body) >= MAX_CONTEXT_CHARS:
        parts.append(_TRUNCATED)
    parts.append(_NOTE)
    return "\n".join(one for one in parts if one)


def _selected_line(context: dict[str, Any]) -> str:
    """把「用户此刻选中的是哪一个」写成一句人话。

    ⚠ 没选中时也要说出来：不说的话，模型会把上一轮记得的那个当成还选着，
    而用户其实早就点到别处去了。

    Args: context。
    """
    chosen = context.get(SELECTED_KEY)
    if isinstance(chosen, dict):
        return _describe(cast("dict[str, Any]", chosen))
    chosen_id = context.get(SELECTED_ID_KEY)
    if isinstance(chosen_id, str) and chosen_id:
        return (
            f"用户此刻选中的是画布节点 `{chosen_id}`。"
            "他说「这个」「当前模块」时指的就是它。"
        )
    return "用户此刻**没有选中**任何画布节点。他说「这个」时先问清是哪一个。"


def _describe(chosen: dict[str, Any]) -> str:
    """选中项的一句话名片。

    Args: chosen。
    """
    label = str(chosen.get("label") or chosen.get("name") or "")
    kind = str(chosen.get("module_type") or chosen.get("type") or "")
    chosen_id = str(chosen.get("id") or "")
    named = f"「{label}」" if label else ""
    typed = f"（{kind}）" if kind else ""
    return (
        f"用户此刻选中的是 {named}{typed} 画布节点 `{chosen_id}`。"
        "他说「这个」「当前模块」时指的就是它，**不要再猜别的**。"
    )


def _dump(context: dict[str, Any]) -> str:
    """摊成一段 JSON，超长就切。

    Args: context。
    """
    body = json.dumps(context, ensure_ascii=False, default=str)
    return body[:MAX_CONTEXT_CHARS]
