"""模块清单的收窄：整份清单一次给不得，按需给。

⚠ 整份清单六万多字符。原样塞进上下文，技能正文与工具结果就都被挤出去了——
表现是助手忽然「忘了」自己刚查到的点位。所以列表只给认模块要的那几格，
配置字段得点名要某一个模块才展开（渐进披露）。

⚠ 收窄之后**仍然是唯一真源**：这里不补任何清单里没有的字段。补出来的东西
写进配置存得下去、也不报错，画面上表现为「配了没反应」。
"""

from typing import Any, cast

# 一次最多列几个模块。清单只有个位数个模块时用不上，留着是因为第三方模块进库
# 之后这份清单会长
MAX_MODULES = 60
# 带上说明时一次最多列几个。⚠ 一条说明 3–6 句，整表六十条就是一万多字符，
# 而被它挤出去的正是技能正文与工具结果。所以说明只在关键词真的筛窄之后才给，
# 且那时也按这个数截断
MAX_DESCRIBED_MODULES = 12


def brief_of(
    module: dict[str, object], *, has_description: bool = True
) -> dict[str, Any]:
    """一个模块的名片：认出它是谁、摆多大、有几个槽、什么时候用它。

    Args: module, has_description（带不带那段说明，见 MAX_DESCRIBED_MODULES）。
    """
    return {
        **_description_of(module, has_description),
        "type": module.get("type"),
        "name": module.get("display_name"),
        "category": module.get("category"),
        "keywords": module.get("keywords") or [],
        "chrome": module.get("chrome") or "card",
        "default_size": _size_of(module.get("default_size")),
        "slots": [_slot_of(one) for one in _list_of(module.get("bindings"))],
        "config_field_count": len(_list_of(module.get("config_schema"))),
        # ⚠ 这两格必须在名片上：装不装得下子节点、是不是钉在页头页脚，决定的是
        # 「这个模块能不能这么摆」。缺了它们模型只能试一次、被拒、再换一个
        "is_container": bool(module.get("is_container")),
        "region": module.get("region"),
    }


def catalog_of(body: object, keyword: str | None) -> dict[str, Any]:
    """把整份清单收成一张名片表，可按关键词筛。

    ⚠ 关键词筛的是 `keywords`（含拼音）与中文名。筛空了**回全表**而不是空表：
    用户说的模块名与清单里的叫法对不上是常事，给空表模型就以为没有这个模块。

    ⚠ 说明只在关键词真的筛窄之后才给：整表带说明会把上下文占掉一大截，
    而模型浏览整表时要的只是「有哪些」。

    Args: body, keyword。
    """
    modules = [_as_body(one) for one in _list_of(_as_body(body).get("modules"))]
    matched = _matching(modules, keyword) if keyword else []
    is_narrowed = bool(matched)
    listed = matched if is_narrowed else modules
    shown = listed[: MAX_DESCRIBED_MODULES if is_narrowed else MAX_MODULES]
    return {
        "modules": [
            brief_of(one, has_description=is_narrowed) for one in shown
        ],
        "total": len(modules),
        "note": _note(len(shown), len(listed), is_narrowed=is_narrowed),
    }


def _note(shown: int, listed: int, *, is_narrowed: bool) -> str:
    """名片表末尾那句话：截断要挑明，没给说明也要挑明。

    Args: shown, listed（筛完共几个）, is_narrowed（关键词筛窄了没有）。
    """
    clipped = (
        f"命中 {listed} 个，只列出前 {shown} 个；关键词再具体些能缩小范围。"
        if listed > shown
        else f"共 {shown} 个。"
    )
    if is_narrowed:
        return clipped + (
            "要摆一个模块或改它的配置，先用 module_type 把那一个的配置字段"
            "拉全——凭印象填的键存得下去但不生效。"
        )
    return clipped + (
        "整表只给名片、**不带说明**（带上会把上下文占掉一大截）。"
        "拿不准该用哪一个模块、它什么时候不该用，给 keyword 筛一下就有说明；"
        "要摆它或改配置，用 module_type 把那一个的配置字段拉全——"
        "凭印象填的键存得下去但不生效。"
    )


def _description_of(
    module: dict[str, object], has_description: bool
) -> dict[str, Any]:
    """名片上的那段说明；不该给或上游没给时整格不出现。

    ⚠ 上游缺这一格时不编一句顶上：编出来的说明会被模型当成事实，
    照着它去配一个并不存在的槽。

    Args: module, has_description。
    """
    given = module.get("description")
    if not has_description or not isinstance(given, str) or not given.strip():
        return {}
    return {"description": given.strip()}


def _matching(
    modules: list[dict[str, object]], keyword: str
) -> list[dict[str, object]]:
    needle = keyword.strip().lower()
    return [one for one in modules if needle in _searchable(one)]


def _searchable(module: dict[str, object]) -> str:
    words = module.get("keywords")
    parts = [str(module.get("type")), str(module.get("display_name"))]
    if isinstance(words, list):
        parts.extend(str(word) for word in cast("list[object]", words))
    return " ".join(parts).lower()


def _slot_of(slot: object) -> dict[str, Any]:
    """一个绑定槽的形状。数组槽要带上行内字段名，否则槽键拼不出来。

    Args: slot。
    """
    body = _as_body(slot)
    fields = [
        _as_body(one).get("key") for one in _list_of(body.get("array_fields"))
    ]
    return {
        "key": body.get("key"),
        "label": body.get("label"),
        "data_type": body.get("data_type"),
        "is_array": bool(body.get("is_array")),
        "array_fields": fields,
    }


def _size_of(given: object) -> dict[str, Any]:
    body = _as_body(given)
    return {"width": body.get("width"), "height": body.get("height")}


def _as_body(given: object) -> dict[str, object]:
    if not isinstance(given, dict):
        return {}
    # ⚠ 收窄一次而不是遍历重建：`isinstance` 从 `object` narrow 出来的是
    # `dict[Unknown, Unknown]`，遍历它的键值同样是未知的
    return cast("dict[str, object]", given)


def _list_of(given: object) -> list[object]:
    if not isinstance(given, list):
        return []
    return cast("list[object]", given)
