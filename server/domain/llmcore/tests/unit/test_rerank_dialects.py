"""两套重排线形各自的请求体与回包读法，以及方言注册表。

假件照着**真实回包**写：Jina 那一族回 `{"results":[{index, relevance_score}]}`
（TEI 那一路回一个裸数组、分数键是 `score`），原生那一路多包一层 `output`。
桩比实现宽的话，两条互相矛盾的用例会同时绿。
"""

import pytest

from llmcore.rerank import (
    DEFAULT_RERANK_DIALECT,
    DIALECT_DASHSCOPE,
    DIALECT_JINA,
    RERANK_DIALECTS,
    RerankQuery,
    RerankShapeUnreadable,
    UnknownRerankDialect,
    dialect_of,
)

_ASK = RerankQuery(
    model="rerank-1", query="轴承怎么判断要换", documents=("甲", "乙"), top_n=2
)


def test_the_default_dialect_is_registered() -> None:
    assert DEFAULT_RERANK_DIALECT in RERANK_DIALECTS


def test_an_empty_code_falls_back_to_the_default() -> None:
    assert dialect_of("").code == DEFAULT_RERANK_DIALECT


def test_an_unknown_code_is_refused_by_name() -> None:
    """⚠ 认不出就抛而不是退回默认：退回默认打出去的是另一套线形。"""
    with pytest.raises(UnknownRerankDialect) as caught:
        dialect_of("cohere-v3")
    assert "cohere-v3" in str(caught.value)


def test_every_registered_dialect_has_a_distinct_path() -> None:
    paths = [dialect_of(one).path for one in RERANK_DIALECTS]
    assert len(set(paths)) == len(paths)


def test_the_jina_body_is_flat() -> None:
    body = dialect_of(DIALECT_JINA).body_of(_ASK)
    assert body == {
        "model": "rerank-1",
        "query": "轴承怎么判断要换",
        "documents": ["甲", "乙"],
        "top_n": 2,
    }


def test_the_jina_dialect_reads_the_results_envelope() -> None:
    made = dialect_of(DIALECT_JINA).scores_of(
        {
            "model": "rerank-1",
            "results": [
                {"index": 0, "relevance_score": 0.21},
                {"index": 1, "relevance_score": 0.87},
            ],
            "usage": {"total_tokens": 12},
        },
        2,
    )
    assert [(one.index, one.score) for one in made] == [(1, 0.87), (0, 0.21)]


def test_the_jina_dialect_also_reads_a_bare_array_with_score() -> None:
    """⚠ TEI 回的就是这副样子：只认一副的表现是「接上了、每次都读不懂」。"""
    made = dialect_of(DIALECT_JINA).scores_of(
        [{"index": 1, "score": 0.4}, {"index": 0, "score": 0.9}], 2
    )
    assert [one.index for one in made] == [0, 1]


def test_the_native_body_splits_input_and_parameters() -> None:
    body = dialect_of(DIALECT_DASHSCOPE).body_of(_ASK)
    assert body == {
        "model": "rerank-1",
        "input": {"query": "轴承怎么判断要换", "documents": ["甲", "乙"]},
        "parameters": {"top_n": 2, "return_documents": False},
    }


def test_the_native_dialect_reads_through_the_output_envelope() -> None:
    made = dialect_of(DIALECT_DASHSCOPE).scores_of(
        {
            "output": {
                "results": [
                    {"index": 1, "relevance_score": 0.33},
                    {"index": 0, "relevance_score": 0.66},
                ]
            },
            "usage": {"total_tokens": 9},
            "request_id": "req-1",
        },
        2,
    )
    assert [(one.index, one.score) for one in made] == [(0, 0.66), (1, 0.33)]


@pytest.mark.parametrize(
    "body",
    [
        {"results": [{"index": 0, "relevance_score": 0.5}]},
        {"output": "不是对象"},
        "根本不是对象",
    ],
)
def test_the_wrong_dialect_refuses_instead_of_giving_an_empty_list(
    body: object,
) -> None:
    """⚠ 空表与「一条都不相关」长得一模一样：解不动一律抛。"""
    with pytest.raises(RerankShapeUnreadable):
        dialect_of(DIALECT_DASHSCOPE).scores_of(body, 1)


@pytest.mark.parametrize(
    "rows",
    [
        [{"relevance_score": 0.5}],
        [{"index": 0}],
        [{"index": True, "relevance_score": 0.5}],
        [{"index": 0, "relevance_score": True}],
        ["不是对象"],
    ],
)
def test_a_row_that_is_missing_a_piece_is_refused(rows: object) -> None:
    with pytest.raises(RerankShapeUnreadable):
        dialect_of(DIALECT_JINA).scores_of({"results": rows}, 1)


def test_an_out_of_range_index_is_caught_here_not_by_the_caller() -> None:
    """⚠ 交给调用方的话那是一条 IndexError，报出来的位置离方言很远。"""
    with pytest.raises(RerankShapeUnreadable) as caught:
        dialect_of(DIALECT_JINA).scores_of(
            {"results": [{"index": 7, "relevance_score": 0.5}]}, 2
        )
    assert "7" in str(caught.value)
