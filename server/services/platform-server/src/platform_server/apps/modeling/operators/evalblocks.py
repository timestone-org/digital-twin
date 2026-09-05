"""五个评估算子的块拼装：算料在 `evalstats.py`，这里只把它们摆进区里。

⚠ 拼装与算料一起放进算子类的话，两个贴着行数上限的算子文件下一次谁都改不动
（docs/MODELING_RESULT_VIEW_DESIGN.md §8.1）。
⚠ 一项都算不出来的块不摆：空块在界面上与「这一步本来就没有这张图」长得一模
一样，而两者要用户做的事不同（规格 §2-P5）。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any

from platform_server.apps.modeling.operators.evalcurves import (
    BINARY_CLASSES,
    CALIBRATION_NOTE,
    GRID_NOTE,
    MULTICLASS_NOTE,
    NO_PROBABILITY_NOTE,
    ONE_SIDED_NOTE,
    PR_NOTE,
    PROBABILITY_NOTE,
    ROC_NOTE,
    Curves,
    calibration_items,
    curves_of,
    grid_items,
    pr_items,
    roc_items,
)
from platform_server.apps.modeling.operators.evalstats import (
    CLASSIFICATION_METRICS,
    REGRESSION_METRICS,
    RESIDUAL_METRICS,
    Scored,
    deviation_of,
    drift_items,
    fold_items,
    fold_score_items,
    metric_items,
    qq_items,
    quantile_items,
    residual_marks,
    worst_items,
)
from platform_server.apps.modeling.operators.reporting import (
    NOTE_ALERT,
    TIER_LARGE,
    TIER_SCALAR,
    TIER_SMALL,
    BlockAt,
    ReportBlock,
    RowCounts,
    Scale,
    TimeAxis,
    Zone,
    annotated,
    axis_block,
    bins_block,
    breakdown_block,
    rows_block,
)
from platform_server.apps.modeling.operators.steps import (
    Stage,
    column_bins,
    funnel_of,
    ratio_of,
    spread_of,
)

# 五个评估算子的输出端口都叫这个名字
PORT = "metrics"
# 残差那一列在图上的名字
RESIDUAL_KEY = "residual"
# 没有基线分读不出重要性的量级，这句话跟着基线一起摆
BASELINE_NOTE = (
    "同一个 0.12 在 R²=0.9 的模型上是砍掉 13% 的解释力，在 R²=0.2 上是砍掉 60%"
)
# 每折的分是什么口径
FOLD_NOTE = "每折的分：回归是 R²、分类是准确率"
_ZERO = 0.0


@dataclass(frozen=True)
class Classified:
    """分类评估这一步实际看到了什么，`report()` 照它讲。"""

    metrics: dict[str, float | None]
    labels: tuple[str, ...]
    matrix: tuple[tuple[int, ...], ...]
    #: 正类在界面上的写法。⚠ config 里那个是浮点数，摘要里的类目是字符串
    positive_text: str
    rows: int
    #: 每行的正类概率；None = 这份打分结果里没有可用的概率列
    probabilities: tuple[float, ...] | None = None
    #: 每行的真实类目是不是正类。三条曲线全部相对它算
    actual_positive: tuple[bool, ...] = ()
    #: 每行被判成的是不是正类。用来反推打分时站的那个阈值
    predicted_positive: tuple[bool, ...] = ()


@dataclass(frozen=True)
class Importances:
    """置换重要性这一步实际算出了什么。"""

    #: 已按重要性降序排好；`feature_keys` 原序在图上读不出任何东西
    items: tuple[dict[str, Any], ...]
    baseline: float | None
    score_kind: str
    rows: int
    repeats: int


@dataclass(frozen=True)
class Folds:
    """交叉验证这一步实际切了什么、跑出了什么。"""

    scores: tuple[float, ...]
    #: 每一折的 (训练行下标, 测试行下标)
    spans: tuple[tuple[Sequence[int], Sequence[int]], ...]
    configured: int
    rows: int
    score_kind: str


def regression_blocks(
    scored: Scored,
    metrics: Mapping[str, float | None],
    buckets: int,
    limit: int,
) -> tuple[ReportBlock, ...]:
    """回归评估的五块：抽样口径、五个指标、残差分布、分位数、最差的那几行。

    Args: scored, metrics, buckets, limit。
    """
    rows = len(scored.truth)
    kept = min(rows, limit)
    return (
        rows_block(
            _at("step", "散点抽样口径", TIER_SCALAR),
            RowCounts(
                before=rows,
                after=kept,
                dropped=rows - kept,
                ratio_actual=ratio_of(kept, rows),
            ),
            funnel=funnel_of(
                (
                    Stage("测试行数", rows, "行"),
                    Stage("散点上限", limit, "点"),
                    Stage("等距抽回", kept, "点"),
                )
            ),
        ),
        breakdown_block(
            _at("stats", "回归指标", TIER_SCALAR),
            Scale(label="测试集上的五个指标"),
            metric_items(REGRESSION_METRICS, metrics),
        ),
        _bins_block(scored.residuals, buckets),
        breakdown_block(
            _at("table", "残差分位数", TIER_SMALL),
            Scale(label="有序残差上的线性插值分位数"),
            quantile_items(scored.residuals),
        ),
        breakdown_block(
            _at("table", "误差最大的那几行", TIER_LARGE),
            Scale(label="按绝对误差降序，残差 = 真实值 − 预测值"),
            worst_items(scored),
        ),
    )


def classification_blocks(view: Classified) -> tuple[ReportBlock, ...]:
    """分类评估的三到八块：判对判错的账、四个指标、类别分布，与概率侧那四样。

    Args: view。
    """
    made = [
        annotated(
            _scope_block(view), NOTE_ALERT, (_missing_curves_note(view),)
        ),
        breakdown_block(
            _at("stats", "分类指标", TIER_SCALAR),
            Scale(label=_positive_note(view)),
            metric_items(CLASSIFICATION_METRICS, view.metrics),
        ),
        breakdown_block(
            _at("charts", "类别分布", TIER_SMALL, is_primary=True),
            Scale(label="真实占比与预测占比并排：模型是不是全押多数类"),
            _class_items(view),
        ),
    ]
    made.extend(_probability_blocks(view))
    return tuple(made)


def residual_blocks(
    scored: Scored, metrics: Mapping[str, float | None], buckets: int
) -> tuple[ReportBlock, ...]:
    """残差分析的三到五块：口径、五个统计量、分布，以及画得出来的 QQ 与时序。

    Args: scored, metrics, buckets。
    """
    rows = len(scored.residuals)
    made = [
        rows_block(
            _at("step", "评估口径", TIER_SCALAR),
            RowCounts(before=rows, after=rows),
            funnel=funnel_of(
                (
                    Stage("测试行数", rows, "行"),
                    Stage("直方桶数", buckets, "个"),
                )
            ),
        ),
        breakdown_block(
            _at("stats", "残差统计量", TIER_SCALAR),
            Scale(label="残差 = 真实值 − 预测值"),
            metric_items(RESIDUAL_METRICS, metrics),
        ),
        _bins_block(scored.residuals, buckets),
    ]
    made.extend(_residual_charts(scored))
    return tuple(made)


def importance_blocks(view: Importances) -> tuple[ReportBlock, ...]:
    """特征重要性的三块：口径、基线分、重要性排行。

    Args: view。
    """
    return (
        rows_block(
            _at("step", "评估口径", TIER_SCALAR),
            RowCounts(before=view.rows, after=view.rows),
            funnel=funnel_of(
                (
                    Stage("测试行数", view.rows, "行"),
                    Stage("特征列数", len(view.items), "列"),
                    Stage("每列打乱", view.repeats, "遍"),
                )
            ),
        ),
        breakdown_block(
            _at("stats", "打乱前的基线分", TIER_SCALAR),
            Scale(
                label=BASELINE_NOTE,
                score_kind=view.score_kind,
                baseline=view.baseline,
            ),
            (
                {
                    "name": _score_name(view.score_kind),
                    "value": view.baseline,
                    "score_kind": view.score_kind,
                },
            ),
        ),
        breakdown_block(
            _at("charts", "特征重要性", TIER_SMALL, is_primary=True),
            Scale(
                label="打乱一列后掉的分；不大于零 = 打乱反而没变差，是噪声列",
                baseline=view.baseline,
            ),
            view.items,
        ),
    )


def fold_blocks(view: Folds) -> tuple[ReportBlock, ...]:
    """交叉验证的三块：配置对实得、逐折分数、折布局。

    Args: view。
    """
    mean = None if not view.scores else sum(view.scores) / len(view.scores)
    return (
        rows_block(
            _at("step", "折的配置与实得", TIER_SCALAR),
            RowCounts(before=view.rows, after=view.rows),
            funnel=funnel_of(_fold_stages(view)),
        ),
        breakdown_block(
            _at("charts", "逐折分数", TIER_SMALL, is_primary=True),
            Scale(label=FOLD_NOTE, score_kind=view.score_kind, baseline=mean),
            fold_score_items(view.scores),
        ),
        axis_block(
            _at("charts", "折布局", TIER_SMALL, is_primary=False),
            TimeAxis(segments=fold_items(view.spans)),
        ),
    )


def _at(
    zone: Zone, title: str, tier: int, *, is_primary: bool | None = None
) -> BlockAt:
    """一块摆在哪儿。五个评估算子都只有一路输出，端口名都一样。

    Args: zone, title, tier, is_primary（图区必填）。
    """
    return BlockAt(
        zone=zone, title=title, port=PORT, tier=tier, is_primary=is_primary
    )


def _bins_block(residuals: Sequence[float], buckets: int) -> ReportBlock:
    """残差分布，带零线、偏均值与 ±1σ 三种参考线，以及同参数的正态曲线。

    ⚠ 正态参考曲线与那两个数出自同一份残差：只印偏均值与离散度两个数字的话，
    「这堆残差正不正态」还是要读者自己在脑子里画一遍（规格 §5-22）。
    Args: residuals, buckets。
    """
    mean = _ZERO if not residuals else sum(residuals) / len(residuals)
    deviation = deviation_of(residuals) or _ZERO
    column = column_bins(
        RESIDUAL_KEY,
        spread_of(residuals, buckets=buckets),
        off_label="算不出的残差",
        marks=residual_marks(mean, deviation),
    )
    if deviation > _ZERO:
        column = replace(column, curve={"mean": mean, "sd": deviation})
    return bins_block(
        _at("charts", "残差分布", TIER_SMALL, is_primary=True), (column,)
    )


def _residual_charts(scored: Scored) -> list[ReportBlock]:
    """画得出来的那两张辅图：正态 QQ 与残差随时间。

    Args: scored。
    """
    made: list[ReportBlock] = []
    quantiles = qq_items(scored.residuals)
    if quantiles:
        made.append(
            breakdown_block(
                _at("charts", "正态 QQ", TIER_SMALL, is_primary=False),
                Scale(label="实测分位对同均值同方差的正态分位"),
                quantiles,
            )
        )
    drift = drift_items(scored)
    if drift:
        made.append(
            breakdown_block(
                _at("charts", "残差随时间", TIER_LARGE, is_primary=False),
                Scale(label="每格取均值；整段偏移在直方图上会摊平成胖尾"),
                drift,
            )
        )
    return made


def _scope_block(view: Classified) -> ReportBlock:
    """判对判错的账：几行、几类、对几行、错几行。

    Args: view。
    """
    hit = sum(
        view.matrix[seat][seat]
        for seat in range(min(len(view.matrix), len(view.labels)))
    )
    return rows_block(
        _at("step", "评估口径", TIER_SCALAR),
        RowCounts(before=view.rows, after=view.rows),
        funnel=funnel_of(
            (
                Stage("测试行数", view.rows, "行"),
                Stage("类目数", len(view.labels), "类"),
                Stage("判对", hit, "行"),
                Stage("判错", view.rows - hit, "行"),
            )
        ),
    )


def _missing_curves_note(view: Classified) -> str:
    """三条曲线为什么不在这一屏上；画得出来时是空串。

    ⚠ 两种「没有」分开写：多分类要用户改建模口径，缺概率列要用户换上游算子，
    合成一句之后两种情形都不知道该做什么（规格 §2-P5）。
    Args: view。
    """
    if len(view.labels) > BINARY_CLASSES:
        return MULTICLASS_NOTE
    return "" if view.probabilities is not None else NO_PROBABILITY_NOTE


def _probability_blocks(view: Classified) -> list[ReportBlock]:
    """概率侧那四样：两个关键数字、ROC、PR、校准曲线，以及阈值网格。

    ⚠ 画不出来的那几张一块都不摆：空块与「这一步本来就没有这张图」在屏幕上长得
    一模一样，而两者的原因已经在第一区那条告警里分开说过了。
    ⚠ 打分那一档要在抽样**之前**先算出来交给 `curves_of`：抽完再标的话它常常
    不在网格上，滑杆默认停到旁边一档，四格与 ② 区的指标卡对不上账。
    Args: view。
    """
    if view.probabilities is None or len(view.labels) > BINARY_CLASSES:
        return []
    stood = _scoring_threshold(view.probabilities, view.predicted_positive)
    curves = curves_of(view.probabilities, view.actual_positive, keep=stood)
    made = [_probability_stats(curves, view)]
    made.extend(_curve_blocks(curves, view.probabilities, view.actual_positive))
    grid = grid_items(curves)
    if grid:
        made.append(
            breakdown_block(
                _at("charts", "阈值网格", TIER_LARGE, is_primary=False),
                Scale(label=GRID_NOTE, baseline=stood),
                grid,
            )
        )
    return made


def _probability_stats(curves: Curves, view: Classified) -> ReportBlock:
    """AUC / AP / 正类占比三个关键数字。

    ⚠ 三个都不套阈值染色：AUC 的随机线在 0.5、AP 的随机线是正类占比，两条都与
    准确率那套档位对不上，套上去会把 AUC=0.55 印成绿的（规格 §2-P3）。
    Args: curves, view。
    """
    block = breakdown_block(
        _at("stats", "概率评估", TIER_SCALAR),
        Scale(label=PROBABILITY_NOTE),
        (
            _stat("AUC", "auc", curves.auc),
            _stat("AP", "average_precision", curves.average_precision),
            _stat(
                f"正类「{view.positive_text}」占比",
                "positive_rate",
                curves.positive_rate,
            ),
        ),
    )
    if curves.auc is not None:
        return block
    return annotated(block, NOTE_ALERT, (ONE_SIDED_NOTE,))


def _curve_blocks(
    curves: Curves,
    probabilities: Sequence[float],
    actual_positive: Sequence[bool],
) -> list[ReportBlock]:
    """画得出来的那几条曲线。

    Args: curves, probabilities, actual_positive。
    """
    made: list[ReportBlock] = []
    roc = roc_items(curves)
    if roc:
        made.append(
            breakdown_block(
                _at("charts", "ROC 曲线", TIER_SMALL, is_primary=True),
                Scale(label=ROC_NOTE),
                roc,
            )
        )
    curve = pr_items(curves)
    if curve:
        made.append(
            breakdown_block(
                _at("charts", "PR 曲线", TIER_SMALL, is_primary=True),
                Scale(label=PR_NOTE, baseline=curves.positive_rate),
                curve,
            )
        )
    calibration = calibration_items(probabilities, actual_positive)
    if calibration:
        made.append(
            breakdown_block(
                _at("charts", "校准曲线", TIER_SMALL, is_primary=False),
                Scale(label=CALIBRATION_NOTE),
                calibration,
            )
        )
    return made


def _scoring_threshold(
    probabilities: Sequence[float], predicted_positive: Sequence[bool]
) -> float | None:
    """打分那一刀反推出来的阈值：判成正类的行里最低的那个概率。

    ⚠ 只能反推：分类评估的入口只有一份打分帧，超参在模型那一侧的负载上，这里拿
    不到。反推值与真超参可以不同（配 0.5、反推得 0.5405），但两者切出来的正类行
    **是同一批**，故网格上这一档的四格与同屏指标卡逐个相等。
    ⚠ 不写死 0.5：阈值是逻辑回归的超参，写死之后网格上那条竖线会指在一个模型
    根本没用过的位置，而同屏的指标卡是按真阈值算的。
    Args: probabilities, predicted_positive。
    """
    seats = [
        value
        for value, flag in zip(probabilities, predicted_positive, strict=True)
        if flag
    ]
    return min(seats) if seats else None


def _stat(name: str, key: str, value: float | None) -> dict[str, Any]:
    """一个没有公认好坏线的关键数字。

    Args: name, key, value。
    """
    return {
        "name": name,
        "key": key,
        "value": value,
        "unit": "",
        "score_kind": "",
    }


def _positive_note(view: Classified) -> str:
    """正类是哪一个，以及它在不在这份测试集里。

    ⚠ 正类可能一次都没出现过：那时精确率与召回率双双无定义，而界面照旧会把
    「无定义」摆在正类徽标旁边，不说清就读成「模型很差」。
    Args: view。
    """
    if view.positive_text in view.labels:
        return f"精确率 / 召回率 / F1 都是相对正类「{view.positive_text}」算的"
    return (
        f"正类「{view.positive_text}」在这份测试集里一次都没出现过，"
        "精确率与召回率无定义"
    )


def _class_items(view: Classified) -> list[dict[str, Any]]:
    """每一类的真实占比与预测占比，并排给。

    Args: view。
    """
    made: list[dict[str, Any]] = []
    for seat, label in enumerate(view.labels):
        if seat >= len(view.matrix):
            break
        truth = sum(view.matrix[seat])
        guessed = sum(row[seat] for row in view.matrix if seat < len(row))
        made.append(
            {
                "name": label,
                "value": ratio_of(truth, view.rows),
                "before": ratio_of(truth, view.rows),
                "after": ratio_of(guessed, view.rows),
                "truth_rows": truth,
                "predicted_rows": guessed,
            }
        )
    return made


def _fold_stages(view: Folds) -> tuple[Stage, ...]:
    """配置几折 → 实得几折 → 每折测试多少行。

    Args: view。
    """
    made = len(view.spans)
    note = (
        ""
        if made == view.configured
        else "前向链的第一折没有可训的行，那一折整折丢弃"
    )
    return (
        Stage("总行数", view.rows, "行"),
        Stage("配置折数", view.configured, "折"),
        Stage("实得折数", made, "折", note),
        Stage("每折测试行", view.rows // max(view.configured, 1), "行"),
    )


def _score_name(score_kind: str) -> str:
    """基线分那一项在界面上叫什么。

    Args: score_kind。
    """
    if score_kind == "r2":
        return "R²"
    return "准确率" if score_kind == "accuracy" else "基线分"
