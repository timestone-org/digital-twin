"""训练 / 测试切分，以及各族模型算子共用的打分帧与任务口径。

⚠ `scored_frame` 与 `single_target` 是公开的：线性族在 `regression.py`、树模型族
在 `trees.py`，两边必须共用同一份打分帧形状与同一条「唯一目标列」判据
——各写一份的话，评估算子读得懂一族、读不懂另一族。
"""

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
    SPLIT_TIME_ORDER,
    Frame,
    FrameColumn,
    frame_input,
    numbers_of,
    select_rows,
    split_row_indices,
    with_roles,
)
from platform_server.apps.modeling.operators.registry import register_operator

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
        return {
            "train": select_rows(frame, sorted(train)),
            "test": select_rows(frame, sorted(test)),
        }


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
