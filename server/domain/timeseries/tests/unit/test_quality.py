"""锁住质量位的三档与兜底方向：认不出的输入判 bad，不判 good。"""

import pytest

from timeseries.quality import (
    FALLBACK_QUALITY,
    QUALITIES,
    normalize_quality,
)


def test_the_three_grades_are_lowercase_and_ordered() -> None:
    assert QUALITIES == ("good", "uncertain", "bad")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("good", "good"),
        ("uncertain", "uncertain"),
        ("bad", "bad"),
        ("GOOD", "good"),
        ("  Uncertain ", "uncertain"),
    ],
    ids=["好", "存疑", "坏", "大写", "带空白"],
)
def test_normalize_accepts_the_three_grades_case_insensitively(
    value: str, expected: str
) -> None:
    assert normalize_quality(value) == expected


@pytest.mark.parametrize(
    "value",
    ["", "ok", "GOOD_ENOUGH", "好", None, 0, 1, True, ["good"]],
    ids=[
        "空串",
        "近义词",
        "带后缀",
        "中文",
        "空值",
        "零",
        "一",
        "布尔",
        "数组",
    ],
)
def test_normalize_falls_back_to_bad_for_anything_unrecognised(
    value: object,
) -> None:
    # ⚠ 兜底方向是 bad：判不出质量位却当好数据用，会污染台账
    assert normalize_quality(value) == "bad"


def test_the_fallback_grade_is_one_of_the_three() -> None:
    assert FALLBACK_QUALITY in QUALITIES
