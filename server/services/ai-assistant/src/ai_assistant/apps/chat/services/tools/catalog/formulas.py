"""函数目录的收窄：函数一次全给太重，说明与样例按需展开。

⚠ 这份目录是**唯一的函数真源**。目录里没有的函数名写出来是「未知函数」，
而用户看到的只是一条报错，不知道那是模型编的。所以宁可少给样例，
也不能少给函数名与签名——那两样决定它写不写得对。

⚠ 九条求值口径（`rules`）**一条都不许省**。它们全是「错了不报错、只是算出来
的数不对」那一类：四则运算遇空整条为空、聚合跳过缺失、`PREV` 不含当前行而
`*_OVER` 含。省掉之后模型照样写得出公式，只是数是错的。
"""

from typing import Any, cast

# 一次最多回几个函数。带上样例的那种更沉，故按词筛之后才给全
MAX_FUNCTIONS = 80

# 这几格无论如何都原样带上：它们是「这张台账能引用什么」与「怎么算」的全部
_PASS_THROUGH = (
    "categories",
    "operators",
    "window_units",
    "rules",
    "columns",
    "tables",
    "library",
)


def catalog_of(body: object, keyword: str | None) -> dict[str, Any]:
    """把函数目录收成一份能进上下文的形状。

    不给关键词时函数只给名字、签名与一句话；给了就只回匹配的那几个，
    并带上样例与参数名。

    Args: body, keyword。
    """
    page = _as_body(body)
    functions = [_as_body(one) for one in _list_of(page.get("functions"))]
    matched = _matching(functions, keyword) if keyword else None
    listed = (matched if matched is not None else functions)[:MAX_FUNCTIONS]
    shape = _full_of if matched is not None else _brief_of
    out: dict[str, Any] = {key: page.get(key) for key in _PASS_THROUGH}
    out["functions"] = [shape(one) for one in listed]
    out["function_total"] = len(functions)
    if matched is not None and not matched:
        out["note"] = f"没有名字或说明里带「{keyword}」的函数，不要自己编一个"
    return out


def _matching(
    functions: list[dict[str, object]], keyword: str
) -> list[dict[str, object]]:
    needle = keyword.strip().lower()
    return [one for one in functions if needle in _searchable(one)]


def _searchable(function: dict[str, object]) -> str:
    parts = [
        str(function.get("name") or ""),
        str(function.get("description") or ""),
        str(function.get("signature") or ""),
    ]
    return " ".join(parts).lower()


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
