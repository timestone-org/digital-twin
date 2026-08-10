"""锁住闸 1 的判定语义：全序、首条命中即终局、跨斜杠通配、无规则即拒绝。

这几条错了都不会报错，只会静默地放行或误拒。
"""

import pytest

from auth_server.apps.auth.services.matching import (
    DecisionReason,
    RuleView,
    decide,
    find_rule,
    is_redundant,
    normalize_path,
    sort_key,
)


def rule(
    pattern: str,
    method: str = "*",
    codes: tuple[str, ...] = (),
    mode: str = "all",
    priority: int = 0,
) -> RuleView:
    return RuleView(
        path_pattern=pattern,
        http_method=method,
        permission_codes=frozenset(codes),
        match_mode=mode,
        priority=priority,
    )


def test_star_matches_across_slashes() -> None:
    rules = [rule("/api/v1/auth/users*", "GET", ("user:view",), priority=1)]
    matched = find_rule(
        rules, path="/api/v1/auth/users/1/permissions", method="GET"
    )
    assert matched is not None


def test_higher_priority_wins_even_when_less_specific() -> None:
    rules = [
        rule("/api/v1/auth/users/*", "GET", ("user:view",), priority=10),
        rule("/api/v1/auth/users/me*", "*", (), priority=99),
    ]
    decision = decide(
        rules,
        path="/api/v1/auth/users/me",
        method="GET",
        held_codes=frozenset(),
    )
    assert decision.allowed


def test_first_match_is_final_even_if_a_looser_rule_would_pass() -> None:
    rules = [
        rule("/x/secret", "GET", ("admin:only",), priority=50),
        rule("/x/*", "GET", (), priority=10),
    ]
    decision = decide(
        rules, path="/x/secret", method="GET", held_codes=frozenset()
    )
    assert not decision.allowed
    assert decision.reason is DecisionReason.INSUFFICIENT


def test_no_matching_rule_denies() -> None:
    decision = decide(
        [], path="/anything", method="GET", held_codes=frozenset({"a"})
    )
    assert not decision.allowed
    assert decision.reason is DecisionReason.NO_RULE


def test_empty_code_rule_allows_any_authenticated_caller() -> None:
    rules = [rule("/open", "GET", (), priority=1)]
    decision = decide(rules, path="/open", method="GET", held_codes=frozenset())
    assert decision.allowed
    assert decision.required_codes == frozenset()


def test_all_mode_requires_every_code() -> None:
    rules = [rule("/x", "GET", ("a", "b"), priority=1)]
    assert not decide(
        rules, path="/x", method="GET", held_codes=frozenset({"a"})
    ).allowed
    assert decide(
        rules, path="/x", method="GET", held_codes=frozenset({"a", "b"})
    ).allowed


def test_any_mode_requires_only_one_code() -> None:
    rules = [rule("/x", "GET", ("a", "b"), mode="any", priority=1)]
    assert decide(
        rules, path="/x", method="GET", held_codes=frozenset({"b"})
    ).allowed


def test_method_specific_rule_ignores_other_methods() -> None:
    rules = [rule("/x", "POST", ("w",), priority=1)]
    assert find_rule(rules, path="/x", method="GET") is None


def test_wildcard_method_matches_everything() -> None:
    rules = [rule("/x", "*", (), priority=1)]
    assert find_rule(rules, path="/x", method="DELETE") is not None


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("/a/b?x=1", "/a/b"),
        ("/a/b/", "/a/b"),
        ("/", "/"),
        ("", "/"),
        ("/a#frag", "/a"),
    ],
    ids=["query", "trailing-slash", "root", "empty", "fragment"],
)
def test_path_normalization(raw: str, expected: str) -> None:
    assert normalize_path(raw) == expected


def test_sort_key_is_a_total_order_on_equal_priority() -> None:
    a = rule("/aaa", "GET", priority=5)
    b = rule("/aaaa", "GET", priority=5)
    assert sort_key(b) < sort_key(a)


def test_rule_matching_a_broader_rule_with_same_verdict_is_redundant() -> None:
    broad = rule("/api/*", "GET", ("v",), priority=10)
    narrow = rule("/api/users*", "GET", ("v",), priority=20)
    assert is_redundant(narrow, [broad, narrow])


def test_rule_with_a_different_verdict_is_not_redundant() -> None:
    broad = rule("/api/*", "GET", ("v",), priority=10)
    narrow = rule("/api/users*", "GET", ("m",), priority=20)
    assert not is_redundant(narrow, [broad, narrow])


def test_only_rule_of_its_kind_is_not_redundant() -> None:
    single = rule("/api/*", "GET", ("v",), priority=10)
    assert not is_redundant(single, [single])
