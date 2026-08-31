"""点位召回的打分。

**这个文件守的是「不瞎猜」**：得分为 0 的候选一律不返回。把毫无关系的点位摆进
候选，模型会以为「就这些了」然后从里面硬挑一个——那比返回空表难查得多。

另守两条侦察来的事实：`address` 一个字都不看（真实现场里 77% 的节点是
`i=2253` 这样的裸数字，零语义），以及编码要按工业缩写表解读才比得了。
"""

from ai_assistant.apps.chat.services.tools.points.recall import (
    PointCandidate,
    expand_code,
    rank,
    score_point,
    unit_meanings,
)


def point(
    code: str, name: str, unit: str | None = None, data_type: str = "float"
) -> PointCandidate:
    return PointCandidate(
        node_key=f"src:{code}",
        code=code,
        name=name,
        unit=unit,
        data_type=data_type,
    )


def test_a_known_abbreviation_expands_to_chinese() -> None:
    assert "温度" in expand_code("K1_TMT_HOT_T_PI")


def test_an_unknown_segment_survives_expansion() -> None:
    # 机组号与自定义标识认不出，但它们仍能参与子串匹配
    assert "K1" in expand_code("K1_TMT_HOT_T_PI")


def test_expansion_is_case_insensitive() -> None:
    assert expand_code("k1_tmt") == expand_code("K1_TMT")


def test_a_known_unit_says_what_it_measures() -> None:
    assert unit_meanings("℃") == ("温度",)


def test_an_unknown_unit_says_nothing() -> None:
    assert unit_meanings("枚") == ()
    assert unit_meanings(None) == ()


def test_an_exact_name_outranks_a_partial_one() -> None:
    exact = score_point(point("A", "出口温度"), keyword="出口温度")
    partial = score_point(point("B", "1号机组出口温度"), keyword="出口温度")
    assert exact.score > partial.score


def test_a_name_hit_outranks_a_code_hit() -> None:
    # 名字是中文全称，最可靠；编码要靠缩写表解读，隔了一层
    by_name = score_point(point("XYZ", "出口温度"), keyword="出口温度")
    by_code = score_point(point("K1_TMT_OUT", "K1TMTOUT"), keyword="出口温度")
    assert by_name.score > by_code.score


def test_a_matching_unit_adds_confidence() -> None:
    with_unit = score_point(point("A", "出口温度", "℃"), keyword="出口温度")
    without = score_point(point("A", "出口温度"), keyword="出口温度")
    assert with_unit.score > without.score


def test_an_expected_unit_is_counted() -> None:
    got = score_point(
        point("A", "某个读数", "kPa"), keyword="某个读数", expect_unit="kPa"
    )
    assert "kPa" in got.why


def test_an_expected_type_is_counted() -> None:
    got = score_point(
        point("A", "运行状态", data_type="bool"),
        keyword="运行状态",
        expect_type="bool",
    )
    assert "bool" in got.why


def test_the_reason_is_never_blank() -> None:
    # `why` 直接交给模型判断该不该信这一条，空着等于没给
    got = score_point(point("A", "毫不相干"), keyword="出口温度")
    assert got.why


def test_ranking_drops_everything_that_matched_nothing() -> None:
    found = rank(
        [point("A", "毫不相干"), point("B", "出口温度")], keyword="出口温度"
    )
    assert [one.point.name for one in found] == ["出口温度"]


def test_ranking_returns_nothing_when_nothing_matched() -> None:
    # 返回空表是正解：硬凑几个出来，模型会从里面挑一个
    assert rank([point("A", "毫不相干")], keyword="出口温度") == []


def test_ranking_honours_the_limit() -> None:
    many = [point(f"C{index}", f"出口温度{index}") for index in range(30)]
    assert len(rank(many, keyword="出口温度", limit=5)) == 5


def test_ranking_is_stable_when_scores_tie() -> None:
    # 顺序不稳的话，同一次检索两次调用给出的候选次序可以不同
    same = [point("B", "出口温度"), point("A", "出口温度")]
    assert [one.point.code for one in rank(same, keyword="出口温度")] == [
        "A",
        "B",
    ]


def test_the_address_is_never_looked_at() -> None:
    # 真实现场 77% 的地址是 `i=2253` 这样的裸数字，按它猜业务含义会稳定地猜错
    assert "address" not in PointCandidate.__dataclass_fields__


def test_a_code_only_hit_still_surfaces() -> None:
    found = rank([point("K1_TMT_HOT_T_PI", "K1TMTHOTTPI")], keyword="温度")
    assert len(found) == 1
    assert "编码解读出" in found[0].why
