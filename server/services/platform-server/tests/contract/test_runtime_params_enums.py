"""运行参数三个闭合集合的两侧：登记项真用到的取值，与对外声明的枚举。

⚠ 字段声明成裸 `str` 时 `openapi.json` **不带 enum**，前端只能照着 docstring
自己抄一份闭合集合——抄漏一个取值的表现是运行期整包抛「未知的 X」，而
typecheck、lint 与全部用例都是绿的。`danger` 的 `on` 就这么漏过一次：后端三个
方向、前端只列了两个，缺的那条恰好是唯一会删数据的那一项。
"""

from typing import Any, get_args

from platform_server.apps.runtime_params.catalog import (
    CATALOG,
    ParamDanger,
    ParamKind,
    ParamTier,
)
from platform_server.apps.runtime_params.schemas import RuntimeParamOut

SCHEMA: dict[str, Any] = RuntimeParamOut.model_json_schema()


def declared_enum(field: str) -> set[str]:
    """`openapi.json` 会给这一格带上的 enum 成员；没带就是空集。

    ⚠ 可空字段在 schema 里是 `anyOf`，enum 藏在其中一支里。

    Args: field 出参字段名。
    """
    node: dict[str, Any] = SCHEMA["properties"][field]
    branches: list[dict[str, Any]] = node.get("anyOf", [node])
    members: set[str] = set()
    for branch in branches:
        members |= set(branch.get("enum", []))
    return members


def used(field: str) -> set[str]:
    """全部登记项在这一格上真正用到的取值（`None` 不算一种取值）。

    Args: field 登记项字段名。
    """
    return {
        value
        for specs in CATALOG.values()
        for spec in specs
        if (value := getattr(spec, field)) is not None
    }


def test_every_registered_value_is_inside_its_closed_set() -> None:
    assert used("kind") <= set(get_args(ParamKind))
    assert used("tier") <= set(get_args(ParamTier))
    assert used("danger") <= set(get_args(ParamDanger))


def test_the_closed_sets_reach_the_wire_as_enums() -> None:
    # 少任何一格，前端就只能照散文抄一份，而抄漏了没有任何东西会红
    assert declared_enum("kind") == set(get_args(ParamKind))
    assert declared_enum("tier") == set(get_args(ParamTier))
    assert declared_enum("danger") == set(get_args(ParamDanger))


def test_both_switch_directions_are_actually_registered() -> None:
    # ⚠ 同为开关方向可以相反：采集开关关掉才危险，清理开关打开才危险。
    # 只用到一种时，另一种在闭合集合里就成了没人验证的死取值
    assert {"off", "on"} <= used("danger")
