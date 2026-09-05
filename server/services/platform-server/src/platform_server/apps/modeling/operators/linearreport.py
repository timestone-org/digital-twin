"""系数型线性模型的结果面算料：系数表、两侧拟合分、共线性、几率比与收敛。

线性回归与逻辑回归讲的话同构（一组按列 key 的系数 + 一个截距），故合在一起。
⚠ 算料与算子类分开：`regression.py` 贴着行数上限
（docs/MODELING_RESULT_VIEW_DESIGN.md §8.1）。
⚠ 截距与系数本身不进块：它们走 `NodeRunOut.fitted` 那个只读出口，块里放的是
摘要里没有、前端也推不出来的那几个数（规格 §4.5）。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from platform_server.apps.modeling.operators.evalstats import even_sample
from platform_server.apps.modeling.operators.frame import (
    Frame,
    matrix_of,
    numbers_of,
)
from platform_server.apps.modeling.operators.modelstats import (
    RankCheck,
    class_items,
    class_text,
    odds_ratio_of,
    rank_check_of,
    scores_of,
    sigmas_of,
    with_hints,
)
from platform_server.apps.modeling.operators.reporting import (
    MAX_CLOUD_POINTS,
    TIER_LARGE,
    TIER_SCALAR,
    TIER_SMALL,
    BlockAt,
    Cloud,
    Item,
    ModelStructure,
    ReportBlock,
    Scale,
    breakdown_block,
    fits_block,
    structure_block,
)

# 条件数超过它就该提醒：列之间高度相关，系数对几行数据的增删都很敏感
CONDITION_ALERT = 1e6
# 各列 σ 差到这么多倍，按 |β| 排序就会把单位小的列顶到最前
SIGMA_SPREAD_ALERT = 10.0
# 少数类占比低于它就提醒：模型很可能全押多数类，而准确率照样好看
IMBALANCE_ALERT = 0.1
# 逻辑回归只做两类
TWO_CLASSES = 2
# 散点坐标留几位有效数字。⚠ 不是为了好看：200 个点的全精度浮点要多花一倍字节，
# 而两位像素宽的点上一位都看不出来
CLOUD_DIGITS = 6

SCORE_LABEL = "训练集与测试集上各算一次：两边差得远就是过拟合"
RESIDUAL_LABEL = "横轴预测值、纵轴残差（真值 − 预测值）；点该均匀散在零线两侧"
TRUTH_LABEL = "横轴预测值、纵轴真值；两轴同尺，点越贴对角线越准"
WEIGHT_LABEL = "每一列的系数，零线居中：正的往右、负的往左"
RANK_LABEL = "满不满秩、条件数多大——系数稳不稳定只有这两个数看得出来"
CLASS_LABEL = "训练集上每一类占多少行"
LOGIT_LABEL = "判成正类的口径，以及这组系数收敛了没有"
FLAT_COLUMN_REASON = "训练集上这一列没有变化，它的系数与别的列不可比"

RESIDUAL_NOTE = (
    "点在测试集上取，等距抽到 {points}/{rows} 行："
    "残差随预测值一起变大（喇叭口）是异方差，只有这张图看得出来；"
    "R² 与 RMSE 一个字都不说"
)
TRUTH_NOTE = "对角线是理想线：点整体压在线的一侧就是系统性高估或低估"
WEIGHT_SCALE_NOTE = (
    "条长按 β 的绝对值排，而 β 跟着各列的量纲走：上游没做标准化时它不是重要性，"
    "要比就看系数表里的可比贡献 |β·σ|"
)

DEFICIENT_NOTE = (
    "设计矩阵不满秩（秩 {rank} < 列数 {columns}）：有列是别的列的线性组合，"
    "这时系数会剧烈摇摆、符号甚至整体翻过来，而 R² 照样很高"
)
CONDITION_NOTE = (
    "条件数 {condition:.3g}：列之间高度相关，增删几行数据就能让系数变一个样"
)
SIGMA_NOTE = (
    "各列量纲差得远（σ 从 {low:.3g} 到 {high:.3g}）：按 |β| 排序会把单位小的"
    "列顶到最前，要比就比可比贡献 |β·σ|，或者先加一步标准化"
)
SIGMOID_NOTE = (
    "系数不是直接加到预测值上：先算 z = β₀ + Σβⱼxⱼ，再过一层 sigmoid 得到概率，"
    "最后拿概率与阈值 {threshold:g} 比大小"
)
THRESHOLD_NOTE = (
    "判正类的阈值是 {threshold:g}：概率不小于它就判正类，"
    "而全部分类指标都只是这一个阈值上的切片——调低它换召回、调高换精确率"
)
DEFAULTS_NOTE = (
    "penalty 与 solver 用的是 sklearn 的默认（L2 + lbfgs）："
    "这一步只传了截距开关与正则化强度 C"
)
PROBABILITY_NOTE = (
    "打分结果里每一行都带正类概率（列 y_proba）："
    "换个阈值不用重训，ROC / PR / 校准曲线要的也是它"
)
NOT_CONVERGED_NOTE = (
    "迭代撞上了上限（{n_iter}/{max_iter}）：这组系数还没收敛，结果不可信，"
    "先加一步标准化再跑一次"
)
IMBALANCE_NOTE = (
    "少数类只占 {share:.1%}，而阈值是 {threshold:g}：模型很可能全押多数类，"
    "而准确率照样好看"
)


@dataclass(frozen=True)
class Trained:
    """一次线性族拟合实际看到了什么，块照它讲。"""

    train: Frame
    test: Frame
    keys: tuple[str, ...]
    target: str
    #: 测试集上的预测，与 `test` 同序
    predicted: list[float]
    coef: dict[str, float]
    intercept: float
    use_intercept: bool
    #: 这一步用的口径：线性是 none / ridge，逻辑回归是 sklearn 默认的 l2
    method: str


@dataclass(frozen=True)
class LogitTrained:
    """逻辑回归比线性多出来的三样：两个类目、迭代了几轮、上限是多少。"""

    fit: Trained
    classes: list[float]
    #: 实际迭代轮数；None = 估计器没记下来
    n_iter: int | None
    max_iter: int
    #: 这一次判正类用的概率阈值
    threshold: float


def linear_blocks(seen: Trained) -> tuple[ReportBlock, ...]:
    """线性回归讲的话：拟合概况与共线性、系数、两侧拟合分，与三张诊断图。

    Args: seen。
    """
    rows = matrix_of(seen.train, seen.keys)
    sigmas = sigmas_of(rows, seen.keys)
    check = rank_check_of(rows, use_intercept=seen.use_intercept)
    return (
        _gist_block(seen, check, sigmas),
        _coef_block(seen, sigmas),
        _score_block(seen, rows),
        *_chart_blocks(seen, sigmas),
    )


def _chart_blocks(
    seen: Trained, sigmas: Mapping[str, float]
) -> tuple[ReportBlock, ...]:
    """③ 区那三张：残差对预测、真值对预测、每一列的系数。

    ⚠ 两张散点都标主体图：辅图那一格在 72rem 的弹窗里只有半幅宽，而两轴刻度
    随画幅等比缩，摆进去刻度字会掉到 10px 上（规格 §3.2 的辅图网格）。
    Args: seen, sigmas。
    """
    pairs = even_sample(_pairs_of(seen), MAX_CLOUD_POINTS)
    made = [_weight_block(seen, sigmas)]
    if not pairs:
        return tuple(made)
    unit = seen.train.column_of(seen.target).unit
    residual = _cloud_block(
        "残差对预测值",
        Cloud(
            key="residual",
            name="残差",
            mode="residual",
            x_label=_axis_text("预测值", unit),
            y_label=_axis_text("残差", unit),
            points=[
                [_short(guess), _short(value - guess)] for guess, value in pairs
            ],
        ),
        RESIDUAL_LABEL,
        (RESIDUAL_NOTE.format(points=len(pairs), rows=seen.test.row_count),),
    )
    truth = _cloud_block(
        "真值对预测值",
        Cloud(
            key="truth",
            name="每一行",
            mode="pairs",
            x_label=_axis_text("预测值", unit),
            y_label=_axis_text("真值", unit),
            points=[[_short(guess), _short(value)] for guess, value in pairs],
        ),
        TRUTH_LABEL,
        (TRUTH_NOTE,),
    )
    return (residual, truth, *made)


def _short(value: float) -> float:
    """一个坐标留 `CLOUD_DIGITS` 位有效数字。

    Args: value。
    """
    return float(f"{value:.{CLOUD_DIGITS}g}")


def _axis_text(name: str, unit: str) -> str:
    """轴名带上目标列的单位；没单位就只有轴名。

    Args: name, unit。
    """
    return name if unit == "" else f"{name}（{unit}）"


def _pairs_of(seen: Trained) -> list[tuple[float, float]]:
    """测试集上一行一对 `(预测值, 真值)`。

    ⚠ 真值是空的那些行整行不进图：补 0 顶上去会在零附近堆出一片本来不存在的
    点，而图上看着完全正常（规格 §2-P4）。
    Args: seen。
    """
    truth = numbers_of(seen.test, seen.target)
    if len(truth) != len(seen.predicted):
        return []
    return [
        (guess, float(value))
        for value, guess in zip(truth, seen.predicted, strict=True)
        if value is not None
    ]


def _cloud_block(
    title: str, cloud: Cloud, caption: str, notes: Sequence[str]
) -> ReportBlock:
    """一张散点图一块。

    Args: title, cloud, caption, notes。
    """
    block = structure_block(
        BlockAt(zone="charts", title=title, tier=TIER_LARGE, is_primary=True),
        ModelStructure(clouds=(cloud,)),
    )
    return with_hints(block, (caption, *notes))


def _weight_block(seen: Trained, sigmas: Mapping[str, float]) -> ReportBlock:
    """每一列的系数横条，零线居中。

    Args: seen, sigmas。
    """
    block = breakdown_block(
        BlockAt(
            zone="charts",
            title="每一列的系数",
            tier=TIER_SMALL,
            is_primary=False,
        ),
        Scale(label=WEIGHT_LABEL),
        [{"name": key, "value": seen.coef.get(key)} for key in seen.keys],
    )
    spread = [value for value in sigmas.values() if value > 0]
    hint = (
        (WEIGHT_SCALE_NOTE,)
        if spread and max(spread) > min(spread) * SIGMA_SPREAD_ALERT
        else ()
    )
    return with_hints(block, hint)


def logit_blocks(seen: LogitTrained) -> tuple[ReportBlock, ...]:
    """逻辑回归的三块：判别口径与收敛、系数与几率比、训练集类目占比。

    Args: seen。
    """
    rows = matrix_of(seen.fit.train, seen.fit.keys)
    sigmas = sigmas_of(rows, seen.fit.keys)
    return (
        _logit_gist_block(seen),
        _odds_block(seen.fit, sigmas),
        _class_block(seen),
    )


def _gist_block(
    seen: Trained, check: RankCheck | None, sigmas: Mapping[str, float]
) -> ReportBlock:
    """在多少行多少列上拟合的，以及秩与条件数。

    Args: seen, check, sigmas。
    """
    items: list[Item] = [
        {"name": "训练行数", "value": seen.train.row_count},
        {"name": "特征列数", "value": len(seen.keys)},
        {
            "name": "设计矩阵的秩",
            "value": None if check is None else check.rank,
        },
        {
            "name": "条件数",
            "value": None if check is None else check.condition,
        },
    ]
    block = breakdown_block(
        BlockAt(zone="step", title="拟合概况", tier=TIER_SCALAR),
        Scale(label=RANK_LABEL),
        items,
    )
    return with_hints(block, _gist_notes(check, sigmas))


def _gist_notes(
    check: RankCheck | None, sigmas: Mapping[str, float]
) -> tuple[str, ...]:
    """共线性与量纲这两条只有拟合这一步看得见的告警。

    Args: check, sigmas。
    """
    made: list[str] = []
    if check is not None and check.is_deficient:
        made.append(
            DEFICIENT_NOTE.format(rank=check.rank, columns=check.columns)
        )
    if (
        check is not None
        and check.condition is not None
        and check.condition > CONDITION_ALERT
    ):
        made.append(CONDITION_NOTE.format(condition=check.condition))
    spread = [value for value in sigmas.values() if value > 0]
    if spread and max(spread) > min(spread) * SIGMA_SPREAD_ALERT:
        made.append(SIGMA_NOTE.format(low=min(spread), high=max(spread)))
    return tuple(made)


def _coef_block(seen: Trained, sigmas: Mapping[str, float]) -> ReportBlock:
    """系数、每列的 σ、以及可比贡献 |β·σ|。

    Args: seen, sigmas。
    """
    return fits_block(
        BlockAt(zone="formula", title="系数与可比贡献", tier=TIER_SMALL),
        method=seen.method,
        train_rows=seen.train.row_count,
        total_rows=seen.train.row_count + seen.test.row_count,
        by_column=[
            _coef_item(key, seen.coef.get(key), sigmas.get(key))
            for key in seen.keys
        ],
    )


def _coef_item(key: str, coef: float | None, sigma: float | None) -> Item:
    """系数表上的一行。

    Args: key, coef, sigma。
    """
    scaled = None if coef is None or sigma is None else abs(coef) * sigma
    return {
        "key": key,
        "params": {"coef": coef, "sigma": sigma, "contribution": scaled},
        "skipped_reason": FLAT_COLUMN_REASON if sigma == 0 else "",
    }


def _score_block(seen: Trained, rows: Sequence[Sequence[float]]) -> ReportBlock:
    """训练分与测试分，四个数各摆一张卡。

    ⚠ 两侧各摆一张而不是只摆测试侧：指标卡只读 `value`，把训练分放进
    `before` 里等于没放——而这一块要说的正是两边差多少。
    ⚠ 四个数各带各的 `score_kind`：R² 有公认的好坏线、RMSE 跟着目标列的量纲
    走，用同一档口径染色会把一个很好的 RMSE 判成「差」。
    Args: seen, rows。
    """
    train = scores_of(_target_of(seen.train, seen.target), _guessed(seen, rows))
    test = scores_of(_target_of(seen.test, seen.target), seen.predicted)
    unit = seen.train.column_of(seen.target).unit
    return breakdown_block(
        BlockAt(zone="stats", title="训练分与测试分", tier=TIER_SCALAR),
        Scale(label=SCORE_LABEL),
        (
            _score_item("训练 R²", "r2", train.r2, unit=""),
            _score_item("测试 R²", "r2", test.r2, unit=""),
            _score_item("训练 RMSE", "rmse", train.rmse, unit=unit),
            _score_item("测试 RMSE", "rmse", test.rmse, unit=unit),
        ),
    )


def _score_item(name: str, key: str, value: float | None, *, unit: str) -> Item:
    """一侧的一个分。

    Args: name, key, value, unit。
    """
    return {
        "name": name,
        "key": key,
        "unit": unit,
        "score_kind": key,
        "value": value,
    }


def _logit_gist_block(seen: LogitTrained) -> ReportBlock:
    """正类是哪个值、迭代了几轮、以及三条读法上的必备提醒。

    Args: seen。
    """
    items: list[Item] = [
        {"name": "训练行数", "value": seen.fit.train.row_count},
        {"name": "特征列数", "value": len(seen.fit.keys)},
        {"name": "迭代轮数", "value": seen.n_iter},
        {"name": "迭代上限", "value": seen.max_iter},
    ]
    block = breakdown_block(
        BlockAt(zone="step", title="判别口径与收敛", tier=TIER_SCALAR),
        Scale(label=_positive_label(seen)),
        items,
    )
    return with_hints(block, _logit_notes(seen))


def _positive_label(seen: LogitTrained) -> str:
    """正类是两个类目里靠后那个。

    Args: seen。
    """
    if len(seen.classes) < TWO_CLASSES:
        return LOGIT_LABEL
    return (
        f"{LOGIT_LABEL}；正类是「{class_text(seen.classes[-1])}」，"
        f"另一类是「{class_text(seen.classes[0])}」"
    )


def _logit_notes(seen: LogitTrained) -> tuple[str, ...]:
    """四条读法提醒，外加没收敛与类不平衡两条告警。

    Args: seen。
    """
    made = [
        SIGMOID_NOTE.format(threshold=seen.threshold),
        THRESHOLD_NOTE.format(threshold=seen.threshold),
        DEFAULTS_NOTE,
        PROBABILITY_NOTE,
    ]
    if seen.n_iter is not None and seen.n_iter >= seen.max_iter:
        made.append(
            NOT_CONVERGED_NOTE.format(
                n_iter=seen.n_iter, max_iter=seen.max_iter
            )
        )
    share = _minority_share(seen)
    if share is not None and share < IMBALANCE_ALERT:
        made.append(
            IMBALANCE_NOTE.format(share=share, threshold=seen.threshold)
        )
    return tuple(made)


def _minority_share(seen: LogitTrained) -> float | None:
    """少数类在训练集上占多大一块；算不出来给 `None`。

    Args: seen。
    """
    values = _target_of(seen.fit.train, seen.fit.target)
    if not values or not seen.classes:
        return None
    counts = [
        sum(1 for value in values if value == one) for one in seen.classes
    ]
    return min(counts) / len(values)


def _odds_block(seen: Trained, sigmas: Mapping[str, float]) -> ReportBlock:
    """系数、几率比 exp(β) 与每列的 σ。

    Args: seen, sigmas。
    """
    return fits_block(
        BlockAt(zone="formula", title="系数与几率比", tier=TIER_SMALL),
        method=seen.method,
        train_rows=seen.train.row_count,
        total_rows=seen.train.row_count + seen.test.row_count,
        by_column=[
            _odds_item(key, seen.coef.get(key), sigmas.get(key))
            for key in seen.keys
        ],
    )


def _odds_item(key: str, coef: float | None, sigma: float | None) -> Item:
    """几率比表上的一行。

    Args: key, coef, sigma。
    """
    return {
        "key": key,
        "params": {
            "coef": coef,
            "sigma": sigma,
            "odds_ratio": None if coef is None else odds_ratio_of(coef),
        },
        "skipped_reason": FLAT_COLUMN_REASON if sigma == 0 else "",
    }


def _class_block(seen: LogitTrained) -> ReportBlock:
    """训练集上每一类占多少行。

    Args: seen。
    """
    return breakdown_block(
        BlockAt(
            zone="charts",
            title="训练集类目占比",
            tier=TIER_SMALL,
            is_primary=True,
        ),
        Scale(label=CLASS_LABEL, unit="行"),
        class_items(_target_of(seen.fit.train, seen.fit.target), seen.classes),
    )


def _guessed(seen: Trained, rows: Sequence[Sequence[float]]) -> list[float]:
    """训练集上的预测。

    ⚠ 就地按系数算而不是调算子：那一份要的是帧，而这里手上已经是矩阵了。
    Args: seen, rows。
    """
    return [
        seen.intercept
        + sum(
            seen.coef.get(key, 0.0) * value
            for key, value in zip(seen.keys, row, strict=True)
        )
        for row in rows
    ]


def _target_of(frame: Frame, key: str) -> list[float]:
    """目标列的取值。拟合那一步已经挡掉空值，这里不会补出假数。

    Args: frame, key。
    """
    return [float(value or 0.0) for value in numbers_of(frame, key)]
