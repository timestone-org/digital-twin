"""会话自动命名：起不出来也不留空，起过名的不覆盖。

⚠ 这一层不打库——`autotitle` 的库那两步由集成用例验。这里钉的是收拾模型
回来那句话的规矩，以及兜底那一条。
"""

import pytest

from knowledge_server.apps.chat.services.title_service import (
    MAX_TITLE_CHARS,
    _cleaned,
    fallback_title,
)


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("「冷却水运行参数」。", "冷却水运行参数"),
        ('"设备保养周期"', "设备保养周期"),
        ("【绿色生产指数】", "绿色生产指数"),
        ("冷凝器出口温度上限\n\n", "冷凝器出口温度上限"),
        ("  多余   空格  收拢 ", "多余 空格 收拢"),
    ],
)
def test_the_model_reply_is_tidied_into_a_list_row(raw: str, want: str) -> None:
    """⚠ 引号与句号**一起剥、两端都剥**：分两步剥的话，「冷却水参数」。
    会先掉引号再掉句号，剩下一个孤零零的右引号。"""
    assert _cleaned(raw) == want


def test_a_long_reply_is_cut_to_the_row_width() -> None:
    made = _cleaned("这是一个非常非常长的标题超过十六个字了应该被截断")
    assert len(made) == MAX_TITLE_CHARS


def test_a_reply_that_is_only_punctuation_becomes_empty() -> None:
    """⚠ 收拾完是空串时，调用方要退回兜底那一条——把空标题落库等于没起名。"""
    assert _cleaned("。。。") == ""
    assert _cleaned("") == ""


def test_the_fallback_takes_the_head_of_what_the_user_asked() -> None:
    """⚠ 起不出来也**绝不留空**：清单上一排「未命名」谁也分不清哪个是哪个。"""
    made = fallback_title("  冷凝器出口温度的上限是多少？另外压差怎么算  ")
    assert made == "冷凝器出口温度的上限是多少？另外"
    assert len(made) == MAX_TITLE_CHARS


def test_the_fallback_collapses_whitespace() -> None:
    """⚠ 按**字符**截而不是按词：中文没有空格，按词截等于不截。"""
    assert fallback_title("冷却水\n\n出口温度") == "冷却水 出口温度"
