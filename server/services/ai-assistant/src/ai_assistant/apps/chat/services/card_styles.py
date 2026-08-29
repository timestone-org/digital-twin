"""卡片样式库的读写：一条样式是用户存下来的**一整套观感**。

分两袋：外壳 `chrome`（写进节点的 `__cardStyle`，任何模块都吃）与内芯 `config`
（某一个模块自己的观感键）。线上叫 `chrome_json` / `config_json`。
形状与套用语义见 docs/CARD_STYLE_LIBRARY_DESIGN.md §1、§2。

⚠ 清单只给名片：一条样式的外壳就有 40 个键，整表带上取值会把技能正文与工具
结果一起挤出上下文（与模块清单同一个道理）。要取值就点名要那一条。
"""

from typing import Any, cast

from ai_assistant.upstream import PlatformClient

# 一次最多列几条样式。再多模型也读不完，而每一条都在占上下文
MAX_STYLES = 20

# 套用那一步的口径。⚠ 「样式里没有的外壳键要删掉」是这里最容易漏的一条：
# 外壳的语义是「键不存在 = 没设置」，留着就是上一套样式的残留
_APPLY_NOTE = (
    "chrome 里的键逐个写进节点的 ['__cardStyle','<键>']，"
    "config 里的键写在配置顶层。"
    "⚠ 外壳是「键不存在 = 没设置」：节点上有、而这套样式里没有的外壳键"
    "要写 null 删掉，留着就是上一套样式的残留。"
    "⚠ config 是这个模块自己的观感键，写到别的模块类型上既不报错也不生效。"
)

_SAVED_NOTE = (
    "样式库是全站共享的，这一条别人也看得见。"
    "同一套观感再调一次就改这一条（带 style_id），不要每调一次就存一条新的。"
)

_DELETED_NOTE = (
    "样式库是全站共享的，删掉之后别人也没有了。"
    "已经套用过它的节点不受影响——套用是把取值抄进节点，不是引用。"
)


class StyleRequestRefused(ValueError):
    """这一套样式没法存：少了必给的一格，或者内芯落错了地方。"""


async def list_styles(
    platform: PlatformClient, headers: dict[str, str], module_type: str | None
) -> dict[str, Any]:
    """列样式名片：id、名字、一句话、绑的模块类型。

    Args: platform, headers（要转发的身份头）, module_type（只列绑这个模块
        类型的那一组）。
    """
    rows, total = _page_of(
        await platform.list_card_styles(headers, module_type=module_type)
    )
    shown = rows[:MAX_STYLES]
    return {
        "styles": [_brief_of(row) for row in shown],
        "note": _list_note(len(shown), total, module_type),
    }


async def read_style(
    platform: PlatformClient, headers: dict[str, str], style_id: str
) -> dict[str, Any]:
    """展开一条样式：外壳与内芯的完整取值。

    Args: platform, headers, style_id。
    """
    row = await platform.read_card_style(headers, style_id)
    return {"style": _style_of(row), "note": _APPLY_NOTE}


async def save_style(
    platform: PlatformClient,
    headers: dict[str, str],
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """建或改一条样式；给了 style_id 就是改那一条。

    Args: platform, headers, arguments（模型给的那一袋参数）。
    """
    style_id = _text_or_none(arguments.get("style_id"))
    body = _body_of(arguments, is_new=style_id is None)
    if style_id is None:
        row = await platform.create_card_style(headers, body)
    else:
        row = await platform.update_card_style(headers, style_id, body)
    return {"style": _style_of(row), "note": _SAVED_NOTE}


async def delete_style(
    platform: PlatformClient, headers: dict[str, str], style_id: str
) -> dict[str, Any]:
    """删一条样式。

    Args: platform, headers, style_id。
    """
    await platform.delete_card_style(headers, style_id)
    return {"ok": True, "deleted_id": style_id, "note": _DELETED_NOTE}


def _body_of(arguments: dict[str, Any], *, is_new: bool) -> dict[str, Any]:
    """样式的线上形状：两袋观感按 `*_json` 落，没给的键一格都不带。

    ⚠ 没给的键不带而不是写 null：改一条样式时捎上 `module_type: null`
    会把它从「绑 info-card」变成通用样式，内芯键随即整段作废；捎上一袋空
    `chrome_json` 则把用户调好的外壳整袋抹平，而两件事都不报错。

    Args: arguments, is_new（新建；改那一路的取值由上游按存量校验）。
    """
    module_type = _text_or_none(arguments.get("module_type"))
    chrome = _bag_or_none(arguments, "chrome")
    config = _bag_or_none(arguments, "config")
    _check(module_type, chrome, config, is_new=is_new)
    body: dict[str, Any] = {"name": _required(arguments, "name")}
    description = _text_or_none(arguments.get("description"))
    if description is not None:
        body["description"] = description
    if is_new and module_type is not None:
        body["module_type"] = module_type
    if chrome is not None:
        body["chrome_json"] = chrome
    if config is not None:
        body["config_json"] = config
    return body


def _check(
    module_type: str | None,
    chrome: dict[str, Any] | None,
    config: dict[str, Any] | None,
    *,
    is_new: bool,
) -> None:
    """存一条样式的三条底线，都指到字段地说清。

    Args: module_type, chrome, config, is_new。
    """
    if not is_new:
        # ⚠ 上游的 PATCH 入参里根本没有 module_type 这一格，捎上去是一次 422；
        # 而它挡的本来就是「换了类型、那袋内芯从此静默不生效」
        if module_type is not None:
            raise StyleRequestRefused(
                "改一条已有样式换不了 module_type：内芯键是逐模块的，"
                "换了类型那袋 config 会一直躺着、套用时静默不生效。"
                "要换类型就不给 style_id、新建一条"
            )
        return
    if module_type is None and config:
        raise StyleRequestRefused(
            "不给 module_type 就是通用外壳样式，那一档不许带 config："
            "内芯键是逐模块的，套到别的模块上既不报错也不生效。"
            "要存内芯就把 module_type 一起给"
        )
    if not chrome and not config:
        raise StyleRequestRefused(
            "这一条样式一个观感键都没有：chrome 给外壳那一袋"
            "（写进 __cardStyle 的键），config 给这个模块自己的观感键，"
            "至少要有一袋"
        )


def _brief_of(row: object) -> dict[str, Any]:
    """一条样式的名片：认出它是谁、套到哪一类模块上。

    ⚠ 两袋取值不上名片，缩略图更不上：缩略图是 data URL，一张几十 KB。

    Args: row。
    """
    body = _as_body(row)
    return {
        "id": body.get("id"),
        "name": body.get("name"),
        "description": body.get("description"),
        "module_type": body.get("module_type"),
    }


def _style_of(row: object) -> dict[str, Any]:
    """一条样式的完整取值。

    ⚠ 出参的 `chrome` / `config` 与 `styles.save` 的入参同名：模型要照着一条
    改一条时，取回来的那两袋能原样递回去。

    Args: row。
    """
    body = _as_body(row)
    return {
        "id": body.get("id"),
        "name": body.get("name"),
        "description": body.get("description"),
        "module_type": body.get("module_type"),
        "chrome": _bag_of(body.get("chrome_json")),
        "config": _bag_of(body.get("config_json")),
        "updated_at": body.get("updated_at"),
    }


def _list_note(shown: int, total: int, module_type: str | None) -> str:
    """清单末尾那句话：空库要说清怎么起一条，截断要挑明。

    ⚠ 空库照「真的没有」念，不许含糊：模型编一个 style_id 出来，套上去的是
    一次 404，而它会当成自己这一侧坏了。

    Args: shown, total, module_type。
    """
    if shown == 0:
        scope = f"绑 {module_type} 的" if module_type else ""
        return (
            f"库里还没有{scope}样式，不要编一个 style_id。"
            "用 modules.catalog 的预设起个底，调好了用 styles.save 存一条"
        )
    if total > shown:
        return (
            f"共 {total} 条，只列出前 {shown} 条；"
            "给 module_type 能缩到某一个模块类型"
        )
    return f"共 {shown} 条，已全部列出；要某一条的完整取值用 styles.get"


def _page_of(body: object) -> tuple[list[object], int]:
    """从分页体里取 items 与 total；不是分页体就当空。

    Args: body。
    """
    page = _as_body(body)
    items = page.get("items")
    rows = cast("list[object]", items) if isinstance(items, list) else []
    total = page.get("total")
    return rows, total if isinstance(total, int) else len(rows)


def _bag_or_none(arguments: dict[str, Any], name: str) -> dict[str, Any] | None:
    """取一袋键值对参数；没给就是 None，给了别的形状就抛。

    ⚠ 形状不对时抛而不是当空袋收下：模型偶尔把整袋序列化成一个字符串递过来，
    收成空袋的话，存下来的是一条什么观感都没有的样式，而它看着存成功了。

    Args: arguments, name。
    """
    given = arguments.get(name)
    if given is None:
        return None
    if not isinstance(given, dict):
        raise StyleRequestRefused(
            f"{name} 要一袋键值对，不是 {type(given).__name__}"
        )
    return cast("dict[str, Any]", given)


def _bag_of(given: object) -> dict[str, Any]:
    """把上游那一袋 JSON 收成一张确定形状的表。

    Args: given。
    """
    if not isinstance(given, dict):
        return {}
    return cast("dict[str, Any]", given)


def _required(arguments: dict[str, Any], name: str) -> str:
    """取一个非空的字符串参数；没有就抛。

    Args: arguments, name。
    """
    given = _text_or_none(arguments.get(name))
    if given is None:
        raise StyleRequestRefused(f"少了参数 {name}")
    return given


def _as_body(row: object) -> dict[str, object]:
    """把上游那一行收成一张确定形状的表。

    Args: row。
    """
    if not isinstance(row, dict):
        return {}
    # ⚠ 收窄一次而不是遍历重建：`isinstance` 从 `object` narrow 出来的是
    # `dict[Unknown, Unknown]`，遍历它的键值同样是未知的
    return cast("dict[str, object]", row)


def _text_or_none(given: Any) -> str | None:
    if isinstance(given, str) and given.strip():
        return given.strip()
    return None
