"""公开面的联动规则改写：跨屏跳转的目标换成目标屏的**公开令牌**。

⚠ 规则里存的是**别的大屏的 id**（登录态的句柄就是 id）。原样下发有两处坏：
匿名载荷里会出现内部标识，与 ADR-0014「公开面不回任何能定位它在库里位置的
信息」直接冲突；而拿着 id 在公开态也跳不动——公开路由要的是令牌。

⚠ 目标没发布就把**整条规则丢掉**，不是把目标改成空串：留着规则，源控件仍会
摆出可点击外观，点下去什么也不发生——「点了没反应」正是本仓一路在躲的那种
表现（DASHBOARD_NAV_DESIGN §4）。

⚠ 认不出形状的规则一律原样透传，不猜：JSONB 是无类型的，这里只认自己要改的
那两档动作。丢弃不认识的规则会让公开页与登录态的联动行为悄悄不一致。
"""

import uuid
from collections.abc import Mapping
from typing import Any, cast

# 外观袋里存联动规则的那一段。⚠ 键名与前端的
# `web/app/src/features/dashboard/interactionRules.ts` 各写一份，改名要一起改
INTERACTIONS_CHROME_KEY = "interactions"
# 要改写目标的两档动作，其余动作都在本屏内改易失态，与公开态无关
NAVIGATE_ACTION = "navigate"
NAVIGATE_BY_VALUE_ACTION = "navigateByValue"


def navigate_target_ids(chrome_json: Mapping[str, Any]) -> set[uuid.UUID]:
    """外观袋里全部跨屏跳转指向的大屏 id。

    ⚠ 解不成 uuid 的目标直接忽略：那是「还没挑目标」的空串或一条脏规则，
    它们不该让整段改写失败。

    Args: chrome_json。
    """
    found: set[uuid.UUID] = set()
    for rule in _rules(chrome_json):
        action = _as_record(rule.get("action"))
        if action is None:
            continue
        for target in _targets_of(action):
            handle = _as_uuid(target)
            if handle is not None:
                found.add(handle)
    return found


def public_chrome(
    chrome_json: Mapping[str, Any], *, tokens: Mapping[uuid.UUID, str]
) -> dict[str, Any]:
    """公开面的外观袋：跳转目标改成令牌，跳不到的规则整条丢掉。

    Args: chrome_json, tokens（大屏 id → 它当前的公开令牌，只含已发布的）。
    """
    rest = {
        key: value
        for key, value in chrome_json.items()
        if key != INTERACTIONS_CHROME_KEY
    }
    rules = [
        rewritten
        for rewritten in (
            _public_rule(rule, tokens) for rule in _rules(chrome_json)
        )
        if rewritten is not None
    ]
    if rules:
        rest[INTERACTIONS_CHROME_KEY] = rules
    return rest


def _as_record(value: object) -> dict[str, Any] | None:
    """JSONB 里的一个对象；不是对象给 None。

    ⚠ 这里是无类型 JSONB 的入口，`Any` 只在这一层出现并立刻收敛成
    `dict[str, Any]`——放它继续往下流，后面每一处取值都成了 Unknown。
    Args: value。
    """
    if not isinstance(value, dict):
        return None
    return cast("dict[str, Any]", value)


def _as_list(value: object) -> list[Any] | None:
    """JSONB 里的一个数组；不是数组给 None。

    Args: value。
    """
    if not isinstance(value, list):
        return None
    return cast("list[Any]", value)


def _rules(chrome_json: Mapping[str, Any]) -> list[dict[str, Any]]:
    """外观袋里的规则表；形状不对就当没有联动。

    Args: chrome_json。
    """
    raw = _as_list(chrome_json.get(INTERACTIONS_CHROME_KEY))
    if raw is None:
        return []
    return [item for item in (_as_record(one) for one in raw) if item]


def _targets_of(action: Mapping[str, Any]) -> list[str]:
    """一条动作里的全部跳转目标句柄。

    Args: action。
    """
    kind = action.get("type")
    if kind == NAVIGATE_ACTION:
        target = action.get("target")
        return [target] if isinstance(target, str) else []
    if kind != NAVIGATE_BY_VALUE_ACTION:
        return []
    routes = _as_list(action.get("routes")) or []
    targets: list[str] = []
    for item in routes:
        route = _as_record(item)
        target = None if route is None else route.get("target")
        if isinstance(target, str):
            targets.append(target)
    return targets


def _public_rule(
    rule: Mapping[str, Any], tokens: Mapping[uuid.UUID, str]
) -> dict[str, Any] | None:
    """一条规则的公开形态；跳不到任何地方时给 None（整条丢掉）。

    Args: rule, tokens。
    """
    action = _as_record(rule.get("action"))
    if action is None:
        return dict(rule)
    kind = action.get("type")
    if kind == NAVIGATE_ACTION:
        token = _token_of(action.get("target"), tokens)
        if token is None:
            return None
        return {**rule, "action": {**action, "target": token}}
    if kind != NAVIGATE_BY_VALUE_ACTION:
        return dict(rule)
    routes = _public_routes(action.get("routes"), tokens)
    if not routes:
        # 一条路由都跳不到，与「没配这条规则」是同一件事
        return None
    return {**rule, "action": {**action, "routes": routes}}


def _public_routes(
    raw: object, tokens: Mapping[uuid.UUID, str]
) -> list[dict[str, Any]]:
    """按值分流的公开形态：跳不到的那几条去掉，其余原样。

    Args: raw, tokens。
    """
    routes: list[dict[str, Any]] = []
    for item in _as_list(raw) or []:
        route = _as_record(item)
        if route is None:
            continue
        token = _token_of(route.get("target"), tokens)
        if token is not None:
            routes.append({**route, "target": token})
    return routes


def _token_of(target: object, tokens: Mapping[uuid.UUID, str]) -> str | None:
    """一个句柄对应的公开令牌；目标没发布或句柄不合法时给 None。

    Args: target, tokens。
    """
    if not isinstance(target, str):
        return None
    handle = _as_uuid(target)
    return None if handle is None else tokens.get(handle)


def _as_uuid(raw: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None
