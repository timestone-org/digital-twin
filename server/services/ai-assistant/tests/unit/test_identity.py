"""转发给 platform 的身份头。

守两条：只挑该转发的那几个（多转无关头没有意义），以及**缺失的头不补空串**——
补了的话下游收到一组「齐全但内容为空」的头，失败原因会从「少了一个头」变成
「签名不符」，而后者听起来像被篡改。
"""

from ai_assistant.upstream.identity import FORWARDED, caller_headers


def test_the_seven_signed_headers_go_through() -> None:
    given = {name: f"v{index}" for index, name in enumerate(FORWARDED)}
    assert caller_headers(given) == given


def test_unrelated_headers_are_left_behind() -> None:
    got = caller_headers(
        {"X-Auth-User-Id": "u1", "Authorization": "Bearer x", "Host": "h"}
    )
    assert got == {"X-Auth-User-Id": "u1"}


def test_a_missing_header_is_omitted_not_blanked() -> None:
    got = caller_headers({"X-Auth-User-Id": "u1"})
    assert "X-Auth-Sig" not in got


def test_an_empty_header_is_treated_as_missing() -> None:
    got = caller_headers({"X-Auth-User-Id": "u1", "X-Auth-Sig": ""})
    assert "X-Auth-Sig" not in got


def test_nothing_in_means_nothing_out() -> None:
    assert caller_headers({}) == {}
