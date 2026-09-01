"""名次融合：两路都命中的块自然排到前面，而分数不参与融合。"""

import uuid

from knowledge_server.apps.knowledge.services.retrieval import RRF_K, fused

A = uuid.UUID("00000000-0000-7000-8000-00000000000a")
B = uuid.UUID("00000000-0000-7000-8000-00000000000b")
C = uuid.UUID("00000000-0000-7000-8000-00000000000c")


def test_a_chunk_hit_by_both_lanes_wins() -> None:
    """⚠ 这正是混合检索的收益所在，不是巧合：两路都说它像，它就更可能像。"""
    made = fused(
        {
            "vector": [(A, "余弦 0.7"), (B, "余弦 0.9")],
            "keyword": [(B, "字面 0.3"), (C, "字面 0.2")],
        }
    )
    assert made[0].chunk_id == B


def test_the_reasons_from_both_lanes_are_kept() -> None:
    """⚠ 「为什么它排在这」要交出去：选哪一条由调用方定，
    因为只有它知道用户这句话的上下文。"""
    made = fused({"vector": [(A, "余弦 0.7")], "keyword": [(A, "字面 0.3")]})
    assert set(made[0].reasons) == {"余弦 0.7", "字面 0.3"}


def test_scores_never_enter_the_fusion() -> None:
    """⚠ 按**名次**融合而不是按分数加权：两路的分数不是同一个量纲
    （余弦相似度 vs trigram 相似度），加权要先定标，而定标参数会随语料漂移。
    这里把一路的分数抬到天上，名次不变则结果不变。"""
    low = fused({"vector": [(A, "0.01")], "keyword": [(B, "0.02")]})
    high = fused({"vector": [(A, "9.99")], "keyword": [(B, "9.98")]})
    assert [one.chunk_id for one in low] == [one.chunk_id for one in high]


def test_the_first_place_of_one_lane_beats_the_second_of_another() -> None:
    made = fused({"vector": [(A, ""), (B, "")]})
    assert made[0].chunk_id == A
    assert made[0].score > made[1].score


def test_the_smoothing_constant_keeps_ranks_close() -> None:
    """⚠ 取 60 是这套方法的常用值：太小则第一名一家独大，
    太大则名次之间拉不开差距。"""
    made = fused({"vector": [(A, ""), (B, "")]})
    assert made[0].score == 1.0 / (RRF_K + 1)
    assert made[1].score == 1.0 / (RRF_K + 2)


def test_nothing_in_nothing_out() -> None:
    assert fused({}) == []
    assert fused({"vector": []}) == []
