"""列 key 放行中文、拒绝公式语法里的每一个记号。

⚠ 这条正则同时写在 pydantic 与迁移的 CHECK 里，两份的转义规则还不一样（SQL
字面量的单引号要写两个、POSIX 字符类里的方括号要转义）。**光看是看不出转义有
没有写对的**，只有逐个字符断言能证明。
"""

import pytest
from pydantic import BaseModel, ValidationError

from platform_server.apps.dataset.schemas.common import ColumnKey

# 每一个都是公式语法里的记号，混进 key 就会让 `{key}` 引用切不回这一列
FORBIDDEN_CHARACTERS = (
    " ",
    "\t",
    "'",
    '"',
    "(",
    ")",
    ",",
    ".",
    ":",
    "{",
    "}",
    "[",
    "]",
    "@",
)


class _Holder(BaseModel):
    """只为把 `ColumnKey` 的约束跑起来。"""

    key: ColumnKey


@pytest.mark.parametrize("value", ["进水量", "inflow_1", "一号机_电耗", "a-b"])
def test_a_key_without_formula_tokens_is_accepted(value: str) -> None:
    """中文与常见标识符写法都放行——`{进水量}` 比 `{inflow}` 好读得多。"""
    assert _Holder(key=value).key == value


@pytest.mark.parametrize("character", FORBIDDEN_CHARACTERS)
def test_a_key_carrying_a_formula_token_is_rejected(character: str) -> None:
    """逐个字符地证明转义写对了。

    ⚠ 花括号漏掉的表现最隐蔽：`{a}b}` 会先匹配掉 `{a}`，剩下的 `b}` 成为垃圾，
    报的是一个指错位置的语法错误，而那一列在配置界面上看起来完全正常。
    ⚠ `@` 漏掉的表现是报「调用库公式要带括号」——指向一个用户根本没写的东西。
    """
    with pytest.raises(ValidationError):
        _Holder(key=f"a{character}b")
