"""闸 1 的判定核心：纯函数，不碰数据库，可整体单测。

语义：按全序（priority 降 → 模式长度降 → 模式升 → 方法升）逐条 `fnmatch`，
**首条命中即终局**——命中但权限不足不会继续找更宽松的规则，所以排序错了就是直接拒绝。
⚠ `fnmatch` 的 `*` **跨斜杠**匹配（与前端路由 glob 直觉相反），
「前缀兜底 + 差异规则」两层结构正是建立在这一点上。
⚠ 无规则一律拒绝：受管前缀上「查不到规则」不等于「放行」。
"""

from dataclasses import dataclass
from enum import StrEnum
from fnmatch import fnmatchcase

ANY_METHOD = "*"


class DecisionReason(StrEnum):
    """判定结果的成因，用于日志与调试端点。"""

    GRANTED = "granted"
    INSUFFICIENT = "insufficient_permission"
    NO_RULE = "no_matching_rule"


@dataclass(frozen=True)
class RuleView:
    """判定所需的规则视图。与 ORM 解耦，便于单测直接构造。"""

    path_pattern: str
    http_method: str
    permission_codes: frozenset[str]
    match_mode: str
    priority: int


@dataclass(frozen=True)
class Decision:
    """一次闸 1 判定的结果。"""

    allowed: bool
    reason: DecisionReason
    rule: RuleView | None = None

    @property
    def required_codes(self) -> frozenset[str]:
        return self.rule.permission_codes if self.rule else frozenset()


def sort_key(rule: RuleView) -> tuple[int, int, str, str]:
    """判定顺序的全序键。同 priority 下顺序确定，不依赖数据库返回序。

    Args: rule。
    """
    return (
        -rule.priority,
        -len(rule.path_pattern),
        rule.path_pattern,
        rule.http_method,
    )


def normalize_path(raw: str) -> str:
    """去掉 query 与末尾斜杠。根路径保留 `/`。

    Args: raw。
    """
    path = raw.split("?", 1)[0].split("#", 1)[0]
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/") or "/"
    return path or "/"


def find_rule(
    rules: list[RuleView], *, path: str, method: str
) -> RuleView | None:
    """按全序找首条命中的规则。

    Args: rules（无需预排序）, path, method。
    """
    target = normalize_path(path)
    upper = method.upper()
    for rule in sorted(rules, key=sort_key):
        if rule.http_method not in (ANY_METHOD, upper):
            continue
        if fnmatchcase(target, rule.path_pattern):
            return rule
    return None


def decide(
    rules: list[RuleView],
    *,
    path: str,
    method: str,
    held_codes: frozenset[str],
) -> Decision:
    """闸 1 判定。调用方必须**先完成认证**再调它。

    Args: rules, path, method, held_codes（已认证用户的有效权限码）。
    """
    rule = find_rule(rules, path=path, method=method)
    if rule is None:
        return Decision(allowed=False, reason=DecisionReason.NO_RULE)
    # 空码 = 任意已登录用户放行；匿名可达性由边缘免认证 location 保证
    if not rule.permission_codes:
        return Decision(True, DecisionReason.GRANTED, rule)
    satisfied = (
        bool(rule.permission_codes & held_codes)
        if rule.match_mode == "any"
        else rule.permission_codes <= held_codes
    )
    return Decision(
        allowed=satisfied,
        reason=(
            DecisionReason.GRANTED if satisfied else DecisionReason.INSUFFICIENT
        ),
        rule=rule,
    )


def is_redundant(rule: RuleView, others: list[RuleView]) -> bool:
    """规则是否与「它不存在时会命中的那条更宽规则」判定完全相同。

    判定「更宽」用 `fnmatch(窄模式文本, 宽模式)`——窄模式里的 `*` 只是普通字符，
    因此这个判定复用了运行时的匹配语义。

    Args: rule, others（同一张表里的其余规则）。
    """
    remaining = [item for item in others if item is not rule]
    fallback = find_rule(
        remaining, path=rule.path_pattern, method=_probe_method(rule)
    )
    if fallback is None:
        return False
    return (
        fallback.permission_codes == rule.permission_codes
        and fallback.match_mode == rule.match_mode
    )


def _probe_method(rule: RuleView) -> str:
    return "GET" if rule.http_method == ANY_METHOD else rule.http_method
