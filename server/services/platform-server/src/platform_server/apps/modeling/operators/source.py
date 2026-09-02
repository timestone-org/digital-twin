"""数据源算子：从数据台账取一段数据变成特征帧。

⚠ 取数本身**不在算子里**：算子跑在没有数据库连接的子进程里，帧由引擎在事件
循环侧预取好，经保留输入键交进来（docs/MODELING_DESIGN.md §3.3、D17b）。
算子在这里的职责是声明参数 schema——引擎正是照它去取数的。
"""

from typing import Any, Literal

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    PREFETCHED_KEY,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
    moment_field,
    table_field,
)
from platform_server.apps.modeling.operators.frame import (
    Frame,
    empty_keys,
    without_columns,
)
from platform_server.apps.modeling.operators.registry import register_operator

# 一次取数的行上限。硬顶与运行参数里的 MAX_SOURCE_ROWS 同量级，两者取小
MAX_ROW_LIMIT = 200_000
DEFAULT_ROW_LIMIT = 50_000

# 行来源。⚠ 只有采集行走桶身份、同一时刻至多一行；manual/import 的同一时刻
# 合法地有多行，选 `all` 时时间索引不再唯一（§3.3）
type RowSource = Literal["collect", "manual", "import", "all"]


class LedgerSourceConfig(OperatorConfig):
    """台账取数的参数。"""

    table_code: str = table_field(
        title="数据台账", description="从哪张台账取数，填台账编码"
    )
    columns: list[str] = Field(
        default_factory=list[str],
        title="取哪些列",
        description="留空表示取当前全部列",
        json_schema_extra={"x-dt-widget": "column"},
    )
    since: str = moment_field(
        default="-90d",
        title="起始时刻",
        description="绝对时刻，或相对写法如 -90d / -12h",
    )
    until: str = moment_field(
        default="",
        title="截止时刻",
        description="留空表示取到此刻",
    )
    row_source: RowSource = Field(
        default="collect",
        title="行来源",
        description=(
            "collect=按周期聚合出来的行；manual=人工录入；import=导入；"
            "all=全要（同一时刻可能有多行）"
        ),
    )
    row_limit: int = Field(
        default=DEFAULT_ROW_LIMIT,
        ge=1,
        le=MAX_ROW_LIMIT,
        title="行数上限",
        description="取最新的这么多行；触顶会在运行记录与界面上如实标注",
    )
    should_drop_empty_columns: bool = Field(
        default=False,
        title="丢掉整列全空的列",
        description=(
            "打开后，在这段时间里一个值都没有的列不再往下走。"
            "下游若显式引用了被丢掉的列，会在那一步报「没有这一列」"
        ),
    )


@register_operator
class LedgerSource(OperatorBase):
    """从数据台账取一段数据。"""

    CODE = "ledger_source"
    NAME = "台账取数"
    DESCRIPTION = "从一张数据台账按时间范围取行，得到一份等宽的特征帧"
    CATEGORY = "source"
    ICON = "table"
    CONFIG_MODEL = LedgerSourceConfig
    OUTPUTS = (
        PortSpec(
            name="frame",
            contract=CONTRACT_FRAME,
            label="数据",
            description="取到的等宽矩阵，缺失保留为空",
        ),
    )
    # 推理时数据由调用方逐行给，取数这一步整个跳过
    ENABLED_IN_SERVING = False

    @property
    def _config(self) -> LedgerSourceConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, LedgerSourceConfig):  # pragma: no cover
            raise OperatorError("台账取数拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """把引擎预取好的帧交出去，必要时先丢掉整列全空的列。

        Args: inputs。
        """
        frame = inputs.get(PREFETCHED_KEY)
        if not isinstance(frame, Frame):
            raise OperatorError("引擎没有为取数节点准备数据")
        if not frame.columns:
            raise OperatorError("这张台账当前一列都没有，取不出数据")
        if not self._config.should_drop_empty_columns:
            return {"frame": frame}
        kept = without_columns(frame, empty_keys(frame))
        if not kept.columns:
            raise OperatorError("这段时间里每一列都是空值，没有列能往下走")
        return {"frame": kept}
