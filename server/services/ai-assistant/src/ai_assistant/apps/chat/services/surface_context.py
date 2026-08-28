"""工作面快照进提示词：助手此刻**看得见**用户那一屏是什么样。

⚠ 存在的理由是一句用户每天都在说的话：「把**这个**模块的标题改掉」。
没有快照时，「这个」在模型手里没有指代——它只能反问，或者挑一个看着像的
画布节点动手，而后者是这套东西最容易失去信任的地方。

⚠ 选中项**单拎出来说一遍**，不能只让它躺在 JSON 里的一格 `selected_id`。
埋在几十个节点中间的一格 id，模型十次里有三次读不出「用户指的是它」，
而那三次它会去改另一个。多选时**每一个都点名**，否则「把这几个接上」
会被做成「把这一个接上」，剩下的它自己挑。

⚠ 快照有长度上限，超了**明说截断了**。悄悄截断的话，模型会把「我看到的
就是全部」当成事实，然后对着半屏画布下「这一屏没有温度卡」这种结论。
"""

import json
from typing import Any, cast

# 快照进提示词的字符上限。⚠ 有上限：一屏两千个画布节点的整份摘要能有十几万字，
# 而被它挤出去的正是技能正文与工具结果
MAX_CONTEXT_CHARS = 6000

# 多选时最多点名几个。⚠ 有上限：整屏全选是一次点击的事，几百个名字念完
# 就把快照的预算占光了
MAX_NAMED = 12

# 选中项在快照里的三个键。与前端 `AiSurface.snapshot()` 逐字对齐。
# ⚠ `selected` 现在是数组，但**旧的单个对象也必须认**：会话是跨版本的，
# 只认数组会让老前端发来的快照连选中项都读不出来
SELECTED_ID_KEY = "selected_id"
SELECTED_IDS_KEY = "selected_ids"
SELECTED_KEY = "selected"

_HEADING = "## 这一页此刻的样子"

_NOTE = (
    "上面是这一屏的**摘要**，够你认出用户说的是哪一个；"
    "要看全部画布节点、槽位或配置，用对应的读取工具再拉一次。"
)

_TRUNCATED = "⚠ 快照太长，只给了前面一截——别把它当成这一屏的全部。"

_NOTHING_SELECTED = (
    "用户此刻**没有选中**任何画布节点。他说「这个」时先问清是哪一个。"
)

_ONLY_THESE = "他说「这几个」「这些」指的就是这几个，**不要扩大到别的节点**。"


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
    """把「用户此刻选中的是哪几个」写成一句人话。

    ⚠ 没选中时也要说出来：不说的话，模型会把上一轮记得的那个当成还选着，
    而用户其实早就点到别处去了。

    Args: context。
    """
    chosen = _chosen_of(context)
    if not chosen:
        return _NOTHING_SELECTED
    if len(chosen) == 1:
        return _describe(chosen[0])
    return _describe_many(chosen)


def _chosen_of(context: dict[str, Any]) -> list[dict[str, Any]]:
    """收下选中集，三种形状都认：数组、旧的单个对象、光一个 id。

    ⚠ 只认数组的话，老前端发来的快照连选中项都读不出来——会话是跨版本的，
    而读不出来的表现是助手忽然开始反问「你说的是哪一个」。

    Args: context。
    """
    given = context.get(SELECTED_KEY)
    if isinstance(given, list):
        rows = cast("list[object]", given)
        return [
            cast("dict[str, Any]", one) for one in rows if isinstance(one, dict)
        ]
    if isinstance(given, dict):
        return [cast("dict[str, Any]", given)]
    return [{"id": one} for one in _ids_of(context)]


def _ids_of(context: dict[str, Any]) -> list[str]:
    """光给了 id 没给名片时，选中的是哪几个。

    Args: context。
    """
    given = context.get(SELECTED_IDS_KEY)
    if isinstance(given, list):
        rows = cast("list[object]", given)
        return [one for one in rows if isinstance(one, str) and one]
    chosen_id = context.get(SELECTED_ID_KEY)
    if isinstance(chosen_id, str) and chosen_id:
        return [chosen_id]
    return []


def _describe(chosen: dict[str, Any]) -> str:
    """选中项的一句话名片。

    Args: chosen。
    """
    return (
        f"用户此刻选中的是{_named(chosen)}。"
        "他说「这个」「当前模块」时指的就是它，**不要再猜别的**。"
    )


def _describe_many(chosen: list[dict[str, Any]]) -> str:
    """多选时把每一个都点名。

    ⚠ 只说个数不点名，等于让模型自己挑；而它挑错的那一次，用户看到的是
    「我明明选了这三个，它去改了别的」。

    Args: chosen。
    """
    named = "、".join(_named(one) for one in chosen[:MAX_NAMED])
    head = f"用户此刻选中了 {len(chosen)} 个：{named}"
    if len(chosen) <= MAX_NAMED:
        return f"{head}。{_ONLY_THESE}"
    rest = len(chosen) - MAX_NAMED
    return (
        f"{head}——**这份名单在这里截断了**，还有 {rest} 个没列出来。"
        f"{_ONLY_THESE}要挨个动它们之前，先把选中集读全。"
    )


def _named(chosen: dict[str, Any]) -> str:
    """一个选中项写成「名字」（类型）`id` 的样子，缺哪格就少哪格。

    Args: chosen。
    """
    label = str(chosen.get("label") or chosen.get("name") or "")
    kind = str(
        chosen.get("module_type")
        or chosen.get("type")
        or chosen.get("kind")
        or ""
    )
    chosen_id = str(chosen.get("id") or "")
    parts = [f"「{label}」" if label else "", f"（{kind}）" if kind else ""]
    parts.append(f"`{chosen_id}`" if chosen_id else "")
    return "".join(parts) or "一个说不出身份的对象"


def _dump(context: dict[str, Any]) -> str:
    """摊成一段 JSON，超长就切。

    Args: context。
    """
    body = json.dumps(context, ensure_ascii=False, default=str)
    return body[:MAX_CONTEXT_CHARS]
