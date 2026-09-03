"""会话自动命名：起不出来也不留空，起过名的不覆盖。

⚠ 这一层不打库——`autotitle` 的库那两步由集成用例验。这里钉的是收拾模型
回来那句话的规矩，以及兜底那一条。
"""

import pytest
from langchain_core.messages import AIMessage

from knowledge_server.apps.chat.services.title_service import (
    MAX_TITLE_CHARS,
    _asked,
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


class _Blocky:
    """一路把标题放进内容块里的模型（Responses 方言那种）。"""

    def __init__(self, content: object) -> None:
        self.content = content

    async def respond(self, **kwargs: object) -> AIMessage:
        """回一条 content 是块串的消息。

        Args: **kwargs。
        """
        del kwargs
        return AIMessage(
            content=self.content
        )  # pyright: ignore[reportArgumentType]


async def test_a_title_split_into_content_blocks_is_still_a_title() -> None:
    """⚠ 带思考摘要的那几路把摘要与正文分别放进块里，`content` 于是是一串块。
    当成字符串取的话这里恒空，而空的表现是**悄悄退回兜底**——清单上是用户那
    句问话被拦腰截断的前 16 个字，看着像「模型就是这么起的」，没有任何报错。"""
    model = _Blocky(
        [
            {
                "type": "reasoning",
                "summary": [{"type": "summary_text", "text": "想想"}],
            },
            {"type": "text", "text": "「冷却水运行参数」。"},
        ]
    )

    made = await _asked(model, "冷却水出口温度上限是多少", "上限 65 ℃")

    assert made == "冷却水运行参数"


async def test_a_block_reply_without_any_text_falls_back() -> None:
    """⚠ 纯思考、没有正文块时给空串，让调用方走兜底——把空标题落库等于没起名。"""
    model = _Blocky([{"type": "reasoning", "summary": []}])

    assert await _asked(model, "问", "答") == ""
