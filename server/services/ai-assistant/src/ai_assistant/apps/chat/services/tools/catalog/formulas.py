"""公式目录按分区渐进披露，求值规则始终保留。"""

from typing import Any, cast

from ai_assistant.apps.chat.services.tools.pagination import ToolPage

# 这几格无论如何都原样带上：它们是「这张台账能引用什么」与「怎么算」的全部
_PASS_THROUGH = (
    "categories",
    "operators",
    "window_units",
    "rules",
)


def catalog_of(
    body: object, keyword: str | None, arguments: dict[str, Any] | None = None
) -> dict[str, Any]:
    """按分区和分类分页读公式目录；Args: body, keyword, arguments。"""
    given = arguments or {}
    window = ToolPage.parse(given)
    page = _as_body(body)
    section = given.get("section", "functions")
    if section not in ("functions", "columns", "tables", "library"):
        raise ValueError("section 必须是 functions、columns、tables 或 library")
    rows = _list_of(page.get(section))
    category = given.get("category")
    if category:
        rows = [
            one for one in rows if _as_body(one).get("category") == category
        ]
    if keyword:
        rows = [
            one for one in rows if keyword.casefold() in str(one).casefold()
        ]
    listed = window.select(rows)
    shape = _full_of if keyword else _brief_of
    out: dict[str, Any] = {key: page.get(key) for key in _PASS_THROUGH}
    out.update(window.describe(len(rows)))
    out["section"] = section
    out[str(section)] = (
        [shape(_as_body(one)) for one in listed]
        if section == "functions"
        else listed
    )
    out["function_total"] = len(_list_of(page.get("functions")))
    out["section_counts"] = {
        key: len(_list_of(page.get(key)))
        for key in ("functions", "columns", "tables", "library")
    }
    out["note"] = (
        "按section选择分区，按category或keyword缩小范围；需要更多时用next_page继续。"
    )
    if keyword and not rows:
        out["note"] = f"没有名字或说明里带「{keyword}」的条目，不要自己编一个"
    return out


def _brief_of(function: dict[str, object]) -> dict[str, Any]:
    """名字、签名、一句话。够挑出该用哪一个。

    Args: function。
    """
    return {
        "name": function.get("name"),
        "category": function.get("category"),
        "signature": function.get("signature"),
        "description": function.get("description"),
    }


def _full_of(function: dict[str, object]) -> dict[str, Any]:
    """再加上样例与参数名。写的时候才要。

    Args: function。
    """
    return {
        **_brief_of(function),
        "example": function.get("example"),
        "args": function.get("args"),
        "min_args": function.get("min_args"),
        "max_args": function.get("max_args"),
    }


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
