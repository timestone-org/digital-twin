"""打分只排序不取舍，而零分一律不返回。"""

import uuid

from knowledge_server.apps.knowledge.services.indexing import Scored, ranked
from knowledge_server.apps.knowledge.services.indexing.pgvector import literal


def _scored(score: float) -> Scored:
    return Scored(chunk_id=uuid.uuid4(), score=score, why="")


def test_results_come_back_highest_first() -> None:
    made = ranked([_scored(0.1), _scored(0.9), _scored(0.5)], 10)
    assert [one.score for one in made] == [0.9, 0.5, 0.1]


def test_zero_scores_never_come_back() -> None:
    """⚠ 零分不是「弱相关」，是「一点都不沾边」。留着它们的话，一次问不到的
    提问也会返回满满一屏候选，而调用方会从里面挑一条。"""
    made = ranked([_scored(0.0), _scored(0.4)], 10)
    assert [one.score for one in made] == [0.4]


def test_negative_scores_never_come_back() -> None:
    """余弦可以是负的：方向相反的向量比毫无关系还糟。"""
    assert ranked([_scored(-0.2)], 10) == []


def test_the_limit_is_honoured() -> None:
    made = ranked([_scored(0.9), _scored(0.8), _scored(0.7)], 2)
    assert len(made) == 2


def test_an_empty_batch_stays_empty() -> None:
    assert ranked([], 10) == []


def test_a_vector_literal_is_what_pgvector_parses() -> None:
    """⚠ 不用参数绑定直接传列表：asyncpg 不认识 `vector` 这个类型，绑过去是
    一条「could not determine data type」。摊成字符串再 CAST 是官方的走法。"""
    made = literal([1.0, -0.5, 0.25])
    assert made.startswith("[")
    assert made.endswith("]")
    assert made.count(",") == 2
