"""`PREDICT` 的批量相位：收集 → 整批算 → 真实相位读备忘。

⚠ 这一组的立论只有一条：**开不开批量，算出来的数必须逐字节相同**。批量相位是
纯加速——备忘键是「公式标识 + 实参 + 行时刻」，即这次调用的全部输入，所以命中
与否与行序无关；命不中的照样逐行现算（docs/MODELING_PLATFORM_DESIGN.md D11b）。
"""

from datetime import UTC, datetime

from platform_server.apps.dataset.formula import (
    BatchAnalysisModel,
    EvalContext,
    HistoryCache,
    ModelMemo,
    build_externals,
    evaluate,
    parse_formula,
)

TZ = datetime.now(UTC).tzinfo
KNOWN = {"温度", "负荷"}
ROW_TS = datetime(2026, 1, 5, 1, 0, tzinfo=UTC)
CODE = "能耗预测"


class CountingModel:
    """把实参求和乘二，并数清自己被逐行调了几次、整批调了几次。

    ⚠ 形参与两个协议逐字对齐：假件比协议窄的话，真接上模型那条路才炸。
    """

    def __init__(self, *, should_batch: bool = True) -> None:
        self.single_calls = 0
        self.batch_calls = 0
        self._should_batch = should_batch

    @property
    def should_batch(self) -> bool:
        """整批算划不划算。"""
        return self._should_batch

    def predict(
        self, args: list[float | None], at: datetime | None = None
    ) -> float | None:
        """Args: args, at。"""
        del at
        self.single_calls += 1
        if any(item is None for item in args):
            return None
        return 2 * sum(item or 0.0 for item in args)

    def predict_many(
        self, rows: list[tuple[list[float | None], datetime | None]]
    ) -> list[float | None]:
        """Args: rows。"""
        self.batch_calls += 1
        return [self.predict(args, at) for args, at in rows]


def _evaluated(
    values: dict[str, object], memo: ModelMemo | None, model: CountingModel
) -> object:
    """按给定的备忘算一行。

    Args: values, memo, model。
    """
    parsed = parse_formula(
        f"PREDICT('{CODE}', {{温度}}, {{负荷}})", known_keys=KNOWN
    )
    cache = HistoryCache(tz=TZ)
    cache.models = {CODE: model}  # pyright: ignore[reportAttributeAccessIssue]
    return evaluate(
        parsed,
        EvalContext(
            values=values,
            externals=build_externals(parsed.deps, cache, None),
            row_ts=ROW_TS,
            model_memo=memo,
        ),
    )


def test_a_counting_model_satisfies_the_batch_protocol() -> None:
    """假件确实被运行期认成「能整批的模型」。

    ⚠ 认不出来的表现不是报错，是批量相位**整个不跑**，而结果照样对——于是这
    一族用例会全绿，加速却一点没有。
    """
    assert isinstance(CountingModel(), BatchAnalysisModel)


def test_the_collecting_phase_answers_nothing_and_records_the_call() -> None:
    """收集相位一律给 None，并把这次调用原样记下来。"""
    model = CountingModel()
    memo = ModelMemo()
    assert _evaluated({"温度": 25.0, "负荷": 4.0}, memo, model) is None
    assert memo.requests == [(CODE, (25.0, 4.0), ROW_TS)]
    assert model.single_calls == 0


def test_the_real_phase_reads_the_memo_without_calling_the_model() -> None:
    """备忘命中时不再调模型。"""
    model = CountingModel()
    memo = ModelMemo(
        values={(CODE, (25.0, 4.0), ROW_TS): 58.0}, is_collecting=False
    )
    assert _evaluated({"温度": 25.0, "负荷": 4.0}, memo, model) == 58.0
    assert model.single_calls == 0


def test_a_miss_falls_back_to_a_live_prediction() -> None:
    """备忘里没有的那一行照样现算，不给空。

    ⚠ 这是批量相位「只加速不改结果」的支点：少一条就少一格数的话，它就成了
    一个与行序有关的静默缺陷。
    """
    model = CountingModel()
    memo = ModelMemo(is_collecting=False)
    assert _evaluated({"温度": 1.0, "负荷": 2.0}, memo, model) == 6.0
    assert model.single_calls == 1


def test_the_same_row_at_a_different_moment_is_a_different_key() -> None:
    """实参一样、时刻不同就是两次不同的调用。

    ⚠ 时刻不进键的话，带时间特征的模型会拿上一行的答案填这一行——数看着正常。
    """
    model = CountingModel()
    memo = ModelMemo(
        values={(CODE, (25.0, 4.0), datetime(2026, 1, 6, tzinfo=UTC)): 999.0},
        is_collecting=False,
    )
    assert _evaluated({"温度": 25.0, "负荷": 4.0}, memo, model) == 58.0


def test_batching_and_not_batching_agree() -> None:
    """同一批行，开批量与不开批量算出来的数逐个相同。"""
    rows: list[dict[str, object]] = [
        {"温度": 20.0 + step, "负荷": 3.0} for step in range(5)
    ]
    plain = [_evaluated(row, None, CountingModel()) for row in rows]

    model = CountingModel()
    memo = ModelMemo()
    for row in rows:
        _evaluated(row, memo, model)
    memo.values = dict(
        zip(
            memo.requests,
            model.predict_many(
                [(list(key[1]), key[2]) for key in memo.requests]
            ),
            strict=True,
        )
    )
    memo.is_collecting = False
    assert [_evaluated(row, memo, model) for row in rows] == plain


def test_a_model_that_does_not_want_batching_says_so() -> None:
    """通道 A 那些如实说「不划算」，免得为它白跑一趟收集。"""
    assert CountingModel(should_batch=False).should_batch is False


def test_no_memo_means_a_live_prediction_every_time() -> None:
    """没开批量相位时行为与从前一模一样。"""
    model = CountingModel()
    assert _evaluated({"温度": 1.0, "负荷": 2.0}, None, model) == 6.0
    assert model.single_calls == 1
