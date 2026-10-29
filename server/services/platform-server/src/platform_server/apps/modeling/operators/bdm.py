"""能管取数算子；网络预取在 worker 的事务外完成。"""

from typing import Annotated, Any, Literal, Self

from pydantic import Field, StringConstraints, model_validator

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    PREFETCHED_KEY,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
    moment_field,
)
from platform_server.apps.modeling.operators.frame import Frame
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import (
    BlockAt,
    ReportBlock,
    RowCounts,
    annotated,
    rows_block,
)
from platform_server.apps.modeling.schemas.bdm import BdmGranularity, BdmKind

MAX_FORMULAS = 8
MAX_IDENTIFIERS = 10
MAX_ROWS = 200_000
HOUR_MINUTES = 60
MINUTE_INTERVALS = (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60)
type BdmIdentifier = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class BdmSourceConfig(OperatorConfig):
    """BDM 数据类别、业务标识与有界时间窗。"""

    kind: BdmKind = Field(
        default="point",
        title="数据类别",
        description=(
            "point=采集点历史；raw=产供用属性历史；" "formula=EMS 公式结果"
        ),
    )
    identifiers: list[BdmIdentifier] = Field(
        min_length=1,
        max_length=MAX_IDENTIFIERS,
        title="取数标识",
        description=(
            "从目录选择 pointId、propertyId 或公式 code；" "每个标识输出一列"
        ),
        json_schema_extra={
            "x-dt-widget": "bdm-identifiers",
            "uniqueItems": True,
        },
    )
    since: str = moment_field(
        default="-7d",
        title="起始时刻",
        description=(
            "UTC 绝对时刻或 -7d、-12h；"
            "长区间自动分段，仍受行数和取数预算限制"
        ),
    )
    until: str = moment_field(
        default="",
        title="截止时刻",
        description="留空取到本次运行时刻；区间左闭右开",
    )
    granularity: BdmGranularity = Field(
        default="day",
        title="公式粒度",
        description="day=按日；month=按月；hour=按小时；minute=按分钟；仅公式有效",
    )
    interval_minutes: int | None = Field(
        default=None,
        ge=1,
        le=60,
        title="分钟间隔",
        description=(
            "分钟粒度默认 1；" "允许 1、2、3、4、5、6、10、12、15、20、30、60"
        ),
    )
    time_alignment: Literal["complete", "strict"] = Field(
        default="complete",
        title="分时边界",
        description="complete=只取完整周期，自动对齐；strict=严格对齐，未对齐时报错；仅小时/分钟有效",
    )
    value_type: Literal["number", "string"] = Field(
        default="number",
        title="输出值类型",
        description="number=数值，无法转换的值留空并计数；string=文本，保留原值文字",
    )
    row_limit: int = Field(
        default=50_000,
        ge=1,
        le=MAX_ROWS,
        title="行数上限",
        description="按时间对齐后保留最新的这些行；触顶明确标注，缺失不补零",
    )

    @model_validator(mode="after")
    def validate_identifiers(self) -> Self:
        if len(set(self.identifiers)) != len(self.identifiers):
            raise ValueError("取数标识不能重复")
        if self.kind == "formula" and len(self.identifiers) > MAX_FORMULAS:
            raise ValueError("公式最多选择 8 个")
        if (
            self.interval_minutes is not None
            and self.interval_minutes not in MINUTE_INTERVALS
        ):
            raise ValueError(
                "分钟间隔必须为 1、2、3、4、5、6、10、12、15、20、30 或 60"
            )
        self.validate_formula_interval()
        return self

    def validate_formula_interval(self) -> None:
        if self.kind != "formula" or self.interval_minutes is None:
            return
        if self.granularity == "hour" and self.interval_minutes != HOUR_MINUTES:
            raise ValueError("小时粒度的间隔固定为 60 分钟")
        if self.granularity in ("day", "month"):
            raise ValueError("日/月粒度不使用分钟间隔，请清空该参数")

    @property
    def effective_interval_minutes(self) -> int:
        return (
            HOUR_MINUTES
            if self.granularity == "hour"
            else self.interval_minutes or 1
        )


@register_operator
class BdmSource(OperatorBase):
    """将外部能管历史数据作为流水线的起点。"""

    CODE = "bdm_source"
    NAME = "能管取数"
    DESCRIPTION = "读取能管点位、产供用属性或 EMS 公式结果，按时刻对齐为特征帧"
    CATEGORY = "source"
    ICON = "table"
    CONFIG_MODEL = BdmSourceConfig
    ENABLED_IN_SERVING = False
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="数据"),)

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._frame: Frame | None = None

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        del inputs
        keys = (
            tuple(config.identifiers)
            if isinstance(config, BdmSourceConfig)
            else None
        )
        return {"frame": keys}

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        frame = inputs.get(PREFETCHED_KEY)
        if not isinstance(frame, Frame):
            raise OperatorError("BDM 数据尚未预取，无法运行取数节点")
        self._frame = frame
        return {"frame": frame}

    def report(self) -> tuple[ReportBlock, ...]:
        frame = self._frame
        if frame is None:
            return ()
        note = "按 UTC 时刻精确对齐；缺失保留为空；公式时刻表示业务周期起点"
        if frame.provenance.is_truncated:
            note += "；已达到行数上限，更早数据未全部保留"
        block = rows_block(
            BlockAt(zone="step", title="接口取数", port="frame"),
            RowCounts(before=frame.row_count, after=frame.row_count),
        )
        return (
            annotated(
                block,
                "alert" if frame.provenance.is_truncated else "hint",
                (note,),
            ),
        )
