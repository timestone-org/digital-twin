"""训练 / 测试切分，以及各族模型算子共用的打分帧与任务口径。

⚠ `scored_frame` 与 `single_target` 是公开的：线性族在 `regression.py`、树模型族
在 `trees.py`，两边必须共用同一份打分帧形状与同一条「唯一目标列」判据
——各写一份的话，评估算子读得懂一族、读不懂另一族。
"""

from dataclasses import dataclass
from typing import Any, Literal

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
    column_field,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    ROLE_TARGET,
    SPLIT_METHODS,
    SPLIT_RANDOM,
    SPLIT_TIME_ORDER,
    Frame,
    FrameColumn,
    frame_input,
    null_ratio_of,
    numbers_of,
    select_rows,
    split_row_indices,
    with_roles,
)
from platform_server.apps.modeling.operators.modelstats import (
    as_aux,
    with_notes,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import (
    MAX_ITEMS,
    TIER_LARGE,
    TIER_SCALAR,
    TIER_SMALL,
    BlockAt,
    Item,
    ReportBlock,
    RowCounts,
    Scale,
    TimeAxis,
    axis_block,
    bins_block,
    breakdown_block,
    rows_block,
)
from platform_server.apps.modeling.operators.steps import (
    Stage,
    axis_span,
    column_bins,
    funnel_of,
    moment_text,
    ratio_of,
    spread_of,
)

# 两路在图上的叫法。⚠ 它们当的是**系列名**不是列 key：块的标题里已经写着是
# 哪一列，这一层答的是「训练侧还是测试侧」
TRAIN_SERIES = "训练集"
TEST_SERIES = "测试集"
# 时间带上两段的语义色。random 档下两段完全交错，故都标成打乱
TONE_TRAIN = "primary"
TONE_TEST = "secondary"
TONE_SHUFFLED = "shuffled"
# 配的比例与实到比例差过这么多就出一条说明
RATIO_TOLERANCE = 0.005

SAME_PROVENANCE_NOTE = (
    "两路来自同一次取数，切分不改出处：下面两个端口的出处一字不差"
)
RATIO_NOTE = (
    "配的是 {configured:.1%}，而向下取整并至少留一行之后，实际切给测试集的是 "
    "{rows} 行、占 {actual:.1%}"
)
RANDOM_LEAK_NOTE = (
    "随机切分把两段在时间上完全混在一起：靠后的行会进训练集，"
    "指标会虚高而上线之后崩"
)
NO_INDEX_NOTE = "这份数据没有时间索引，看不出测试段是不是真的在训练段之后"
OVERLAP_NOTE = "测试段的起点早于训练段的终点，两段在时间上有重叠"
ORDERED_NOTE = "测试段整段在训练段之后，最早的一行是 {since}"
TARGET_LABEL = "两路共用同一条轴才比得出来：形状差得远就是切歪了"
NULL_LABEL = "两侧差得远的列，多半只在其中一段有数据，上线之后整列是空"

TASK_REGRESSION = "regression"
TASK_CLASSIFICATION = "classification"
# 打分帧上的两列，评估算子按它们取数
SCORED_TRUE = "y_true"
SCORED_PRED = "y_pred"

type SplitMethod = Literal["time_order", "random"]


class SplitDatasetConfig(OperatorConfig):
    """切分的参数。目标列在这里**一次性**指定，下游从列角色读。"""

    target_column: str = column_field(
        title="目标列", description="要预测的那一列"
    )
    method: SplitMethod = Field(
        default=SPLIT_TIME_ORDER,
        title="切分方式",
        description=(
            # ⚠ 警告要单独成段：前端按「值=说明；值=说明」拆这句话去做下拉的
            # 选项文案，跟在 `random=` 后面的话，整句警告就变成了那一项的标签
            "time_order=按时间先后切，靠后的做测试集；"
            "random=随机切；"
            "⚠ 台账数据是时序的，随机切会让未来数据泄漏进训练集"
        ),
    )
    test_ratio: float = Field(default=0.2, gt=0.0, lt=1.0, title="测试集比例")
    random_state: int = Field(
        default=42, ge=0, title="随机种子", description="随机切分时才用得上"
    )
    min_test_rows: int = Field(
        default=1,
        ge=1,
        title="测试集最少行数",
        description="切出来的测试集少于这么多行就当场报错，不往下跑",
    )


@register_operator
class SplitDataset(OperatorBase):
    """切出训练集与测试集，并把目标列的角色打上。"""

    CODE = "split_dataset"
    NAME = "训练测试切分"
    DESCRIPTION = "按时序或随机切出训练集与测试集，并指定要预测的目标列"
    CATEGORY = "model"
    ICON = "layers"
    CONFIG_MODEL = SplitDatasetConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (
        PortSpec(name="train", contract=CONTRACT_FRAME, label="训练集"),
        PortSpec(name="test", contract=CONTRACT_FRAME, label="测试集"),
    )
    # 推理时只有一行，没有切分可言
    ENABLED_IN_SERVING = False
    CHANGES_ROW_COUNT = True
    PROVIDES_SPLIT_PLAN = True

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._split: _Split | None = None

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """切两份出来，两份都带上列角色。

        Args: inputs。
        """
        config = _split_config(self.config)
        frame = with_roles(
            frame_input(inputs, "frame"), target_key=config.target_column
        )
        if frame.column_of(config.target_column).dtype != DTYPE_NUMBER:
            raise OperatorError("目标列必须是数值列")
        train, test = split_row_indices(
            frame.row_count,
            method=config.method,
            test_ratio=config.test_ratio,
            random_state=config.random_state,
        )
        _check_test_rows(config, test_rows=len(test), row_count=frame.row_count)
        made = {
            "train": select_rows(frame, sorted(train)),
            "test": select_rows(frame, sorted(test)),
        }
        self._split = _Split(
            source=frame, train=made["train"], test=made["test"]
        )
        return made

    def report(self) -> tuple[ReportBlock, ...]:
        """切分的四块：比例账、两段时间跨度、目标列分布、每列空值率两侧对比。

        ⚠ 全是节点级（port=""）：这一屏最要紧的问题——测试段在不在训练段之后
        ——问的是两路的关系，挂在任何一路上都答不了。
        """
        split = self._split
        if split is None:
            return ()
        config = _split_config(self.config)
        return (
            _counts_block(split, config),
            *_span_blocks(split, config, self.tz_offset_minutes),
            *_target_blocks(split, config),
            *_null_blocks(split),
        )


@dataclass(frozen=True)
class _Split:
    """切分这一步实际切出了什么，`report()` 照它讲。"""

    #: 切之前那一份
    source: Frame
    train: Frame
    test: Frame


def _counts_block(split: _Split, config: SplitDatasetConfig) -> ReportBlock:
    """行怎么分的：配的比例、实到比例、两路各多少行。

    Args: split, config。
    """
    whole = split.source.row_count
    test_rows = split.test.row_count
    made = rows_block(
        BlockAt(zone="step", title="切分的账", tier=TIER_SCALAR),
        RowCounts(
            before=whole,
            after=whole,
            ratio_configured=config.test_ratio,
            ratio_actual=ratio_of(test_rows, whole),
        ),
        funnel=funnel_of(
            (
                Stage("切分前", whole, "行"),
                Stage(TRAIN_SERIES, split.train.row_count, "行"),
                Stage(TEST_SERIES, test_rows, "行"),
            )
        ),
    )
    return with_notes(made, _counts_notes(split, config))


def _counts_notes(split: _Split, config: SplitDatasetConfig) -> tuple[str, ...]:
    """出处只有一份、实到比例与配的不一样、以及随机切的泄漏。

    Args: split, config。
    """
    made = [SAME_PROVENANCE_NOTE]
    actual = ratio_of(split.test.row_count, split.source.row_count)
    if actual is not None and abs(actual - config.test_ratio) > RATIO_TOLERANCE:
        made.append(
            RATIO_NOTE.format(
                configured=config.test_ratio,
                rows=split.test.row_count,
                actual=actual,
            )
        )
    if not split.source.index:
        made.append(NO_INDEX_NOTE)
    return tuple(made)


def _span_blocks(
    split: _Split, config: SplitDatasetConfig, tz_offset_minutes: int
) -> tuple[ReportBlock, ...]:
    """两路的时间跨度画成一条轴上的两段。没有时间索引时一块都不出。

    Args: split, config, tz_offset_minutes。
    """
    index = split.source.index
    if not index:
        return ()
    span = axis_span(index)
    made = axis_block(
        BlockAt(zone="charts", title="两段的时间跨度", tier=TIER_LARGE),
        TimeAxis(
            tz_offset_minutes=tz_offset_minutes,
            actual_since=moment_text(min(index)),
            actual_until=moment_text(max(index)),
            occupancy=span.occupancy,
            gaps=span.gaps,
            segments=_segments(split, config),
        ),
    )
    return (with_notes(made, _span_notes(split, config)),)


def _segments(split: _Split, config: SplitDatasetConfig) -> tuple[Item, ...]:
    """两路各占哪一段。

    Args: split, config。
    """
    is_shuffled = config.method == SPLIT_RANDOM
    sides = (
        (TRAIN_SERIES, split.train, TONE_TRAIN),
        (TEST_SERIES, split.test, TONE_TEST),
    )
    made: list[Item] = []
    for label, frame, tone in sides:
        edges = _span_of(frame)
        if edges is None:
            continue
        made.append(
            {
                "label": label,
                "tone": TONE_SHUFFLED if is_shuffled else tone,
                "since": edges[0],
                "until": edges[1],
                "since_text": moment_text(edges[0]),
                "until_text": moment_text(edges[1]),
                "rows": frame.row_count,
            }
        )
    return tuple(made)


def _span_notes(split: _Split, config: SplitDatasetConfig) -> tuple[str, ...]:
    """测试段在不在训练段之后——切分这一屏最要紧的那个问题。

    Args: split, config。
    """
    if config.method == SPLIT_RANDOM:
        return (RANDOM_LEAK_NOTE,)
    train = _span_of(split.train)
    test = _span_of(split.test)
    if train is None or test is None:
        return ()
    if test[0] <= train[1]:
        return (OVERLAP_NOTE,)
    return (ORDERED_NOTE.format(since=moment_text(test[0])),)


def _span_of(frame: Frame) -> tuple[int, int] | None:
    """一份帧覆盖的时刻区间；没有索引或一行都没有时给 `None`。

    Args: frame。
    """
    index = frame.index
    return None if not index else (min(index), max(index))


def _target_blocks(
    split: _Split, config: SplitDatasetConfig
) -> tuple[ReportBlock, ...]:
    """目标列在两路上的分布。

    ⚠ 两路共用同一条轴（整列的 min/max）：各按各的跨度分桶的话，两张图看着
    一样高，而它们量的根本不是同一段。
    Args: split, config。
    """
    key = config.target_column
    numbers = [
        value for value in numbers_of(split.source, key) if value is not None
    ]
    if not numbers:
        return ()
    low = min(numbers)
    high = max(numbers)
    made = bins_block(
        BlockAt(
            zone="charts",
            title=f"目标列「{key}」在两路上的分布",
            tier=TIER_SMALL,
        ),
        (
            column_bins(
                TRAIN_SERIES,
                spread_of(numbers_of(split.train, key), low=low, high=high),
            ),
            column_bins(
                TEST_SERIES,
                spread_of(numbers_of(split.test, key), low=low, high=high),
            ),
        ),
    )
    return (as_aux(with_notes(made, (TARGET_LABEL,))),)


def _null_blocks(split: _Split) -> tuple[ReportBlock, ...]:
    """每列空值率两侧对比。两侧都没有空值时一块都不出。

    Args: split。
    """
    items = _null_items(split)
    if not items:
        return ()
    made = breakdown_block(
        BlockAt(
            zone="charts", title="每列空值率：训练 / 测试", tier=TIER_SMALL
        ),
        Scale(label=NULL_LABEL),
        items,
    )
    return (as_aux(made),)


def _null_items(split: _Split) -> list[Item]:
    """按两侧空值率之差降序；两侧都没有空值的列不列。

    ⚠ `value` 给测试侧那个：一列在测试段全空才是上线会出事的那一档。
    Args: split。
    """
    made: list[Item] = []
    for column in split.source.columns:
        before = null_ratio_of(split.train, column.key)
        after = null_ratio_of(split.test, column.key)
        if before <= 0 and after <= 0:
            continue
        made.append(
            {
                "name": column.key,
                "value": after,
                "before": before,
                "after": after,
            }
        )
    made.sort(key=_null_gap_of, reverse=True)
    return made[:MAX_ITEMS]


def _null_gap_of(item: Item) -> float:
    """一列在两侧的空值率差多少，排序用。

    Args: item。
    """
    return abs(float(item["after"]) - float(item["before"]))


def scored_frame(
    test: Frame, target_key: str, predictions: list[float]
) -> Frame:
    """把测试集的真实值与预测值拼成一份两列的帧。

    Args: test, target_key, predictions。
    """
    truth = numbers_of(test, target_key)
    if any(value is None for value in truth):
        raise OperatorError("测试集的目标列里有空值，无法与预测值对齐")
    rows = tuple(
        (float(actual or 0.0), predicted)
        for actual, predicted in zip(truth, predictions, strict=True)
    )
    columns = (
        FrameColumn(key=SCORED_TRUE, name="真实值", dtype=DTYPE_NUMBER),
        FrameColumn(key=SCORED_PRED, name="预测值", dtype=DTYPE_NUMBER),
    )
    return Frame(
        columns=columns,
        rows=rows,
        index=test.index,
        index_name=test.index_name,
        provenance=test.provenance,
    )


def _check_test_rows(
    config: SplitDatasetConfig, *, test_rows: int, row_count: int
) -> None:
    """测试集行数不够就当场报错，并说清是行太少还是比例太小。

    Args: config, test_rows, row_count。
    """
    if test_rows >= config.min_test_rows:
        return
    raise OperatorError(
        f"测试集只切出 {test_rows} 行，少于要求的 {config.min_test_rows} 行："
        f"一共 {row_count} 行数据，按 {config.test_ratio:.0%} 的比例就这么多。"
        "请把取数的范围放宽，或把测试集比例调大"
    )


def single_target(frame: Frame) -> str:
    keys = frame.keys_by_role(ROLE_TARGET)
    if len(keys) != 1:
        raise OperatorError("上游没有指定唯一的目标列，请先接一个切分算子")
    return keys[0]


def _split_config(config: OperatorConfig) -> SplitDatasetConfig:
    # pragma 理由 —— 参数由注册表按算子造，型别不会错
    if not isinstance(config, SplitDatasetConfig):  # pragma: no cover
        raise OperatorError("切分拿到了不匹配的参数")
    return config


__all__ = [
    "SCORED_PRED",
    "SCORED_TRUE",
    "SPLIT_METHODS",
    "TASK_REGRESSION",
    "SplitDataset",
]
