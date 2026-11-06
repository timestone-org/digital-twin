"""小上下文的模型上，一次工具产出能占多少字。

⚠ 这一层守的是「窗口小的模型不会在同一步稳定失败」。实测的那台本地端点
`n_ctx=6656`，而一次 `kb.search` 回执有五千多 token——不收紧的话，检索一跑完
下一次调用必然超窗，而端点回的 400 与长度毫无关系。
"""

from knowledge_server.apps.chat.services import budget

CEILING = 20_000


def test_an_unknown_window_changes_nothing() -> None:
    """⚠ 不知道窗口时不去猜一个小值：猜小了的表现是大窗口的模型也只拿得到
    半份资料，而那与「资料里确实只有这些」分辨不出来。"""
    assert budget.result_chars(0, CEILING) == CEILING


def test_the_measured_endpoint_fits_after_the_squeeze() -> None:
    """现场那台：6656 窗口，固定前缀将近 2000 token。"""
    made = budget.result_chars(6656, CEILING)

    assert made < CEILING
    # 折回 token 之后，连预留的那一份也要塞得进窗口
    assert made / budget.CHARS_PER_TOKEN + budget.RESERVED_TOKENS <= 6656


def test_a_big_window_never_goes_above_the_old_ceiling() -> None:
    """⚠ 预算只会把上限往下收，不会往上放：往上放等于悄悄改了另一条口径。"""
    assert budget.result_chars(200_000, CEILING) == CEILING


def test_a_tiny_window_still_leaves_something_worth_reading() -> None:
    """⚠ 与其喂半句话，不如让模型按「资料不足」回答。"""
    assert budget.result_chars(1000, CEILING) == budget.MIN_RESULT_CHARS


def test_the_per_hit_share_follows_how_many_were_asked_for() -> None:
    """⚠ 按这一次要回几条摊，不按上限摊：模型只要 2 条时该让它看得更全。"""
    few = budget.snippet_chars(4000, 2, 1200)
    many = budget.snippet_chars(4000, 8, 1200)

    assert few > many
    assert few <= 1200


def test_the_per_hit_share_never_exceeds_the_old_ceiling() -> None:
    assert budget.snippet_chars(100_000, 1, 1200) == 1200


def test_no_budget_means_the_old_ceiling() -> None:
    assert budget.snippet_chars(0, 6, 1200) == 1200
