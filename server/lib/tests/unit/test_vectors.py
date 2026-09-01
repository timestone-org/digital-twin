"""向量的编解码与余弦（ADR-0030 决策二）。

守的是「读得出来但算不对」这一类静默故障：字节数对不上时截出来的向量照样能算出
一个余弦，而那个数没有任何意义——它会排进召回里看着像一条正常结果。
"""

import pytest

from lib import vectors


def test_a_vector_survives_a_round_trip() -> None:
    """存进去再读出来必须是同一条，否则召回是错的而没有一处会报错。"""
    made = [0.5, -0.25, 0.125]
    assert vectors.decode(vectors.encode(made)) == pytest.approx(made)


def test_encoding_is_four_bytes_per_number() -> None:
    """float32 是编码的一部分契约：换成 float64 会让存量条目整片读错。"""
    assert len(vectors.encode([1.0, 2.0, 3.0])) == 12


def test_a_truncated_vector_is_refused_instead_of_padded() -> None:
    """补零或截断都能算出一个数，而那个数会排进召回里看着像正常结果。"""
    with pytest.raises(vectors.VectorCorrupt):
        vectors.decode(b"\x00\x01\x02")


def test_the_same_direction_scores_one() -> None:
    """同向即最像，这是排序的基准点。"""
    assert vectors.cosine([1.0, 0.0], [2.0, 0.0]) == pytest.approx(1.0)


def test_orthogonal_directions_score_zero() -> None:
    """正交即毫不相干。"""
    assert vectors.cosine([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_a_zero_vector_scores_zero_instead_of_dividing_by_zero() -> None:
    """零向量除下去是 ZeroDivisionError，而它只在某一条脏数据上才炸。"""
    assert vectors.cosine([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_a_dimension_mismatch_scores_zero_instead_of_raising() -> None:
    """换过嵌入模型的库里两种维数会并存。

    一条读不了的旧记录不该让整次检索失败——它只该排不上去。
    """
    assert vectors.cosine([1.0, 0.0], [1.0, 0.0, 0.0]) == 0.0
