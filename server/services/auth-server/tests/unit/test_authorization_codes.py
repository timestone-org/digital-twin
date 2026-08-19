"""带来源标记的权限行怎么摊成三个码集。

三列各自独立：一个码可以同时是内置的、角色给的、直授的，也可以只占其一。
"""

from auth_server.apps.auth.crud.user import _split_codes


def test_each_source_takes_only_the_rows_flagged_for_it() -> None:
    codes = _split_codes(
        [
            ("dashboard:view", True, True, False),
            ("dashboard:manage", True, False, True),
            ("report:export", False, True, True),
        ]
    )
    assert codes.role_codes == frozenset({"dashboard:view", "report:export"})
    assert codes.direct_codes == frozenset(
        {"dashboard:manage", "report:export"}
    )
    assert codes.builtin_codes == frozenset(
        {"dashboard:view", "dashboard:manage"}
    )


def test_builtin_baseline_keeps_codes_the_caller_does_not_hold() -> None:
    """基准是全集，不随调用者持有多少而缩水。

    ⚠ 缩水的后果不是少判而是**多判**：基准退化成「他持有的那几个」之后
    `builtin <= codes` 恒成立，于是任何账号都会被判成全权。
    """
    codes = _split_codes(
        [
            ("dashboard:view", True, True, False),
            ("system:admin", True, False, False),
        ]
    )
    assert codes.builtin_codes > codes.all_codes


def test_no_rows_means_three_empty_sets() -> None:
    codes = _split_codes([])
    assert codes.role_codes == frozenset()
    assert codes.direct_codes == frozenset()
    assert codes.builtin_codes == frozenset()
