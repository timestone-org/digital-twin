"""模块清单的收窄：整份清单一次给不得，按需给。

⚠ 整份清单六万多字符。原样塞进上下文，技能正文与工具结果就都被挤出去了——
表现是助手忽然「忘了」自己刚查到的点位。所以列表只给认模块要的那几格，
配置字段得点名要某一个模块才展开（渐进披露）。

⚠ 收窄之后**仍然是唯一真源**：这里不补任何清单里没有的字段。补出来的东西
写进配置存得下去、也不报错，画面上表现为「配了没反应」。

展开一个模块时给的是「配置字段全表 + 两张图例 + 预设索引」：图例说的是每一档
`type` 该写什么形状的值（模型没有属性面板可看，只能靠它），预设索引说的是有哪
几套现成观感。⚠ 预设的**值**不在这一层给——八套预设一万多字符，而模型多半只会
用其中一套；要哪一套再带 `preset` 调一次（渐进披露，与整表不给说明同一个道理）。
"""

from typing import Any, cast

from ai_assistant.apps.chat.services.tools.pagination import ToolPage


def brief_of(
    module: dict[str, object], *, has_description: bool = True
) -> dict[str, Any]:
    """一个模块的名片：认出它是谁、摆多大、有几个槽、什么时候用它。

    Args: module, has_description（是否带说明）。
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


def catalog_of(
    body: object, keyword: str | None, arguments: dict[str, Any] | None = None
) -> dict[str, Any]:
    """按分类与关键词分页列模块名片；Args: body, keyword, arguments。"""
    given = arguments or {}
    page = ToolPage.parse(given)
    modules = [_as_body(one) for one in _list_of(_as_body(body).get("modules"))]
    category = given.get("category")
    listed = [
        one
        for one in modules
        if not category or one.get("category") == category
    ]
    matched = _matching(listed, keyword) if keyword else []
    is_narrowed = bool(matched)
    listed = matched if is_narrowed else listed
    shown = page.select(listed)
    return {
        "modules": [
            brief_of(one, has_description=is_narrowed) for one in shown
        ],
        **page.describe(len(listed)),
        "note": (
            "关键词未命中，返回当前分类的名片页；可换词或按next_page继续。"
            if keyword and not matched
            else "按keyword筛选，用next_page继续；选定后用module_type读取详情。"
        ),
    }


def detail_of(body: object, preset_id: str | None) -> dict[str, Any]:
    """展开一个模块：配置字段全表 + 绑定槽 + 两张图例 + 预设索引。

    ⚠ 图例（`field_types` / `binding_data_types`）不是可有可无的装饰：模型没有
    属性面板可看，`type: "enum"` 那一格该写 `options[].value` 里的哪一个、
    `type: "image"` 那一格接不接 CSS 渐变，只有图例说得出来。少了它，模型写进去
    的值形状不对，而值存得下去、也不报错。

    ⚠ 预设只给索引不给值：八套预设一万多字符，模型多半只会用其中一套。
    要哪一套就带 `preset_id` 再调一次。

    Args: body（服务端的模块详情）, preset_id（展开哪一套预设，不要就给
        None）。
    """
    module = _as_body(body)
    if preset_id is not None:
        return _preset_of(module, preset_id)
    out: dict[str, Any] = {
        "type": module.get("type"),
        "name": module.get("display_name"),
        "category": module.get("category"),
        **_description_of(module, True),
        "chrome": module.get("chrome") or "card",
        "default_size": _size_of(module.get("default_size")),
        "is_container": bool(module.get("is_container")),
        "region": module.get("region"),
        "config_schema": _list_of(module.get("config_schema")),
        "content_keys": _list_of(module.get("content_keys")),
        "slots": [_slot_of(one) for one in _list_of(module.get("bindings"))],
    }
    # 出厂就落库的那几个键。⚠ 与字段的 `default` 不是一回事：那个不落库、
    # 只在渲染时兜底，读一个新节点的配置看不见它
    seeded = module.get("default_config")
    if isinstance(seeded, dict) and seeded:
        out["default_config"] = seeded
    # 这一段由整页子编辑器接管，形状不在清单里——照猜着写进去不报错也不渲染
    sub_editor = module.get("sub_editor")
    if isinstance(sub_editor, dict):
        out["sub_editor"] = sub_editor
    presets = _preset_index(module)
    if presets:
        out["presets"] = presets
    out["field_types"] = _list_of(module.get("field_types"))
    out["binding_data_types"] = _list_of(module.get("binding_data_types"))
    out["note"] = _detail_note(module, has_presets=bool(presets))
    return out


def _preset_index(module: dict[str, object]) -> list[dict[str, Any]]:
    """预设的目录页：只有 id、名字与一句话，没有值。

    Args: module。
    """
    index: list[dict[str, Any]] = []
    for one in _list_of(module.get("config_presets")):
        body = _as_body(one)
        row: dict[str, Any] = {
            "id": body.get("id"),
            "label": body.get("label"),
        }
        hint = body.get("hint")
        if isinstance(hint, str) and hint.strip():
            row["hint"] = hint.strip()
        index.append(row)
    return index


def _preset_of(module: dict[str, object], preset_id: str) -> dict[str, Any]:
    """一套预设的完整配置。

    ⚠ 找不到时给的是可选清单而不是空表：预设 id 记岔了是常事，回一张空表
    模型就以为这个模块没有预设，转头去逐个字段凑那套观感。

    Args: module, preset_id。
    """
    wanted = preset_id.strip()
    for one in _list_of(module.get("config_presets")):
        body = _as_body(one)
        if body.get("id") != wanted:
            continue
        return {
            "type": module.get("type"),
            "preset": {
                "id": body.get("id"),
                "label": body.get("label"),
                "hint": body.get("hint"),
                "config": body.get("config") or {},
            },
            "note": (
                "把 `config` 里的键**逐键**写进节点配置（一个键一次 "
                "dashboard.set_config，路径就是那个键；`__cardStyle` 下的键"
                "路径是 ['__cardStyle','<键>']）。预设是浅合并：没列出的键"
                "原样保留，不要先清空再写。"
            ),
        }
    return {
        "type": module.get("type"),
        "preset": None,
        "presets": _preset_index(module),
        "note": f"这个模块没有叫 {wanted} 的预设，可选的在 presets 里。",
    }


def _detail_note(module: dict[str, object], *, has_presets: bool) -> str:
    """展开结果末尾那段话：怎么写、哪几件事写了也不生效。

    Args: module, has_presets（这个模块有没有预设）。
    """
    parts = [
        "改配置用 dashboard.set_config，`path` 就是 config_schema 里的 `key`"
        "（子字段接在后面，如 ['scale','ticks']）；数组字段增删项用 "
        "dashboard.add_config_item / remove_config_item，别整份重写。",
        "⚠ 每一格该写什么形状的值看 field_types；`default` 是**不落库**的渲染"
        "兜底，配置里没有这个键就是没配过——要恢复缺省是把键删掉（值给 null），"
        "不是写一个你以为的默认值进去。",
        "⚠ 带 `when` 的字段只在条件满足时才生效，且条件是链式的：控制它的那个"
        "字段自己不生效时，它也不生效。",
    ]
    if isinstance(module.get("sub_editor"), dict):
        parts.append(
            "⚠ sub_editor 说的那一段配置由整页子编辑器写入，形状不在清单里——"
            "不要往那个键里写。"
        )
    if has_presets:
        parts.append(
            "要一整套现成观感就别逐个字段凑：带 preset=<id> 再调一次本工具，"
            "拿到那一套的完整配置再写。"
        )
    return " ".join(parts)


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
    """一个绑定槽的形状。

    子槽保留自己的类型、名称和时序约束，不能从父槽推断。
    ⚠ `is_entity_pinned` 必须在：它决定「这个槽有几行」——钉行的槽行数跟着
    配置里的实体走、绑一部分是常态；列表式的槽行由绑定条数决定且索引必须
    连续，中间空一格会被服务端拒。两种槽的写法不一样，认错就白写一轮。

    Args: slot。
    """
    body = _as_body(slot)
    fields = [_sub_slot_of(one) for one in _list_of(body.get("array_fields"))]
    out: dict[str, Any] = {
        "key": body.get("key"),
        "label": body.get("label"),
        "data_type": body.get("data_type"),
        "is_array": bool(body.get("is_array")),
        "array_fields": fields,
    }
    if body.get("is_required"):
        out["is_required"] = True
    if body.get("is_array"):
        out["is_entity_pinned"] = bool(body.get("is_entity_pinned"))
    if body.get("is_time_series"):
        out["is_time_series"] = True
    enum_map = body.get("enum_map")
    if isinstance(enum_map, dict):
        out["enum_map"] = enum_map
    return out


def _sub_slot_of(slot: object) -> dict[str, Any]:
    """保留子槽类型、名称、时序与必填约束。Args: slot。"""
    return _slot_of(slot)


def _size_of(given: object) -> dict[str, Any]:
    body = _as_body(given)
    return {
        key: body[key]
        for key in ("width", "height", "min_width", "min_height")
        if key in body
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
