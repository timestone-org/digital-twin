"""台账取数的数值转换：非有限值与转不动的值一样记成「转不动」。

⚠ 'NaN' / 'inf' 这类文本放过去会让摘要统计变成 NaN，进 JSONB 就落不了库。
"""

import pytest

from platform_server.apps.modeling.services.frame_source import _as_number


@pytest.mark.parametrize("raw", ["NaN", "nan", "inf", "-Infinity", 10**400])
def test_non_finite_values_count_as_failed(raw: object) -> None:
    assert _as_number(raw) == (None, True)


@pytest.mark.parametrize(
    ("raw", "expected"), [("1.5", 1.5), (2, 2.0), (True, 1.0)]
)
def test_finite_values_pass(raw: object, expected: float) -> None:
    assert _as_number(raw) == (expected, False)
