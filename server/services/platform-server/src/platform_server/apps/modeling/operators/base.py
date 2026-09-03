"""算子契约：一个算子是什么、端口怎么连、参数怎么声明、拟合参数怎么存取。

四个数据契约常量只在本模块定义一份，步间只有一种表格载体 `frame@v1`——X 与 y
是同一个矩阵的不同列，故「行数对不对齐」在结构上不可能出错。
设计见 docs/MODELING_DESIGN.md §5。
"""

from collections.abc import Mapping
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field

# 一个帧端口上的列 key 与顺序；`None` = 静态推不出来。
# ⚠ 是**有序**的元组不是集合：绑定按位置把形参映射到特征上，顺序一变，存量绑定
# 就静默错位——温度喂进了负荷那一格，算出来的还是个数
type ColumnKeys = tuple[str, ...] | None
type ColumnsByPort = Mapping[str, ColumnKeys]

# 步间唯一的表格载体
CONTRACT_FRAME = "frame@v1"
# 训练好的估计器描述（不含估计器对象本身——它不跨进程回传）
CONTRACT_MODEL = "model@v1"
# 评估指标
CONTRACT_METRICS = "metrics@v1"

CONTRACTS: tuple[str, ...] = (
    CONTRACT_FRAME,
    CONTRACT_MODEL,
    CONTRACT_METRICS,
)

# 算子分类，与前端算子面板的分组一一对应
CATEGORIES: tuple[str, ...] = (
    "source",
    "preprocess",
    "feature",
    "model",
    "evaluate",
)

# 可服务通道：json=拟合参数纯 JSON 表达；binary=二进制产物（本轮不开）
SERVING_CHANNELS: tuple[str, ...] = ("json", "binary")

# 引擎给来源类算子塞预取帧用的保留输入键。端口名不许占用它，注册期校验
PREFETCHED_KEY = "__prefetched__"


class OperatorError(Exception):
    """算子自身判定得出的错误：参数不合法、列不存在、数据形状不对。

    ⚠ 与「代码 bug」分开：这一类要原样透给用户看，其余异常带 traceback 落进
    节点记录的 `error_text`。
    """


class PortSpec(BaseModel):
    """一个端口。

    ⚠ 只有 contract 字符串，不再加一层类型枚举：两层并存时枚举形同虚设，
    还得在每个端口上重复声明一次（设计文档 D11）。
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    contract: str
    # 画在画布上的短标签。端口名是英文标识，用户看不懂 `train` 指的是
    # 训练集还是训练好的模型
    label: str = ""
    is_required: bool = True
    description: str = ""


class OperatorConfig(BaseModel):
    """算子参数的基类。

    ⚠ `extra="forbid"`：默认的 ignore 会把传错名字的参数静默吞掉，于是声明的
    约束永远是空的，而没有任何一处会报错。
    """

    model_config = ConfigDict(extra="forbid")


class OperatorSpec(BaseModel):
    """算子的完整对外描述——出 API 的就是它。

    ⚠ 必须**完整**出 API：只吐参数 schema 而不吐端口的话，前端画布拿不到任何
    端口信息，只能自己硬编码一份端口拓扑（设计文档 D15）。
    """

    model_config = ConfigDict(extra="forbid")

    code: str
    name: str
    description: str
    category: str
    spec_version: str
    icon: str
    inputs: list[PortSpec]
    outputs: list[PortSpec]
    config_schema: dict[str, Any]
    fit_required: bool
    serving_enabled: bool
    serving_window_required: bool
    serving_channel: str


def column_field(
    *,
    title: str,
    description: str = "",
    default: Any = ...,
    default_factory: Any = None,
) -> Any:
    """列引用字段——schema 上带 `x-dt-widget=column`。

    前端据此渲染列选择器；**保存期**的图校验据此检查该列在上游帧里真的存在，
    列名打错不必等到运行时才炸。
    Args: title, description, default, default_factory
    （后两者二选一，与 pydantic 同义）。
    """
    extra: dict[str, Any] = {"x-dt-widget": "column"}
    if default_factory is not None:
        return Field(
            default_factory=default_factory,
            title=title,
            description=description,
            json_schema_extra=extra,
        )
    return Field(
        default, title=title, description=description, json_schema_extra=extra
    )


def table_field(*, title: str, description: str = "") -> Any:
    """台账引用字段——schema 上带 `x-dt-widget=table`，且不许是空串。

    前端据此渲染台账下拉而不是让用户手打编码：打错要等运行时取数才报
    「找不到台账」。
    ⚠ `min_length=1` 不是装饰：光靠 `...` 的话空串是合法的 `str`，一个刚拖进来
    还没选台账的取数节点于是**整份图校验一句话都不说**，要跑到取数那一步才报
    「台账不存在」——而那时整次运行已经失败、下游节点全部 skipped。
    Args: title, description。
    """
    return Field(
        ...,
        min_length=1,
        title=title,
        description=description,
        json_schema_extra={"x-dt-widget": "table"},
    )


def moment_field(*, default: Any, title: str, description: str = "") -> Any:
    """时间点字段——schema 上带 `x-dt-widget=moment`。

    ⚠ 相对写法（`-90d`）与绝对时刻**两种都要保留**：相对时间让流水线导出到
    别的环境仍然有意义，绝对时间用于复现某一段历史。只给日历选择器的话前者
    没法表达。
    Args: default, title, description。
    """
    return Field(
        default,
        title=title,
        description=description,
        json_schema_extra={"x-dt-widget": "moment"},
    )


class OperatorBase:
    """所有算子的基类。

    一个算子类同时承担**训练**与**推理**两种执行语义（设计文档 D14）：
    `REQUIRES_FIT=True` 的训练时把统计量存下来、推理时回灌；
    `ENABLED_IN_SERVING=False` 的推理时整个跳过。用一份代码承担两种模式，
    杜绝训练与线上的特征逻辑漂移。
    """

    # 全局唯一，注册表主键。⚠ 不可改：图里存的就是它
    CODE: ClassVar[str] = ""
    NAME: ClassVar[str] = ""
    # 一句话；同时喂给前端算子面板与将来的模型目录
    DESCRIPTION: ClassVar[str] = ""
    CATEGORY: ClassVar[str] = ""
    # 算子契约版本，导入流水线时比对（不匹配给警告而非拒绝）
    SPEC_VERSION: ClassVar[str] = "1.1"
    # ⚠ 必须是 DtIcon 注册表里已登记的名字：未登记的名字前端静默不渲染
    ICON: ClassVar[str] = "network"
    CONFIG_MODEL: ClassVar[type[OperatorConfig]] = OperatorConfig
    INPUTS: ClassVar[tuple[PortSpec, ...]] = ()
    OUTPUTS: ClassVar[tuple[PortSpec, ...]] = ()
    # 训练学参数、推理套参数
    REQUIRES_FIT: ClassVar[bool] = False
    # 推理时跑不跑
    ENABLED_IN_SERVING: ClassVar[bool] = True
    # 会不会改变行数。图校验据此禁止它插在「带拟合的算子 → 切分」之间：
    # 行数一变，同一份切法算出的训练行就错位了
    CHANGES_ROW_COUNT: ClassVar[bool] = False
    # 推理时需要历史窗口（滞后 / 滚动）——整条流水线因此不可服务
    SERVING_NEEDS_WINDOW: ClassVar[bool] = False
    # 这个算子是不是「切分」：引擎从它身上提取切分计划注入给上游带拟合的算子，
    # 图校验也按它判「带拟合算子下游有几个切分」。⚠ 用类变量而不是判 CODE：
    # 判 CODE 的话，加第二种切分算子要回来改引擎与校验两处
    PROVIDES_SPLIT_PLAN: ClassVar[bool] = False
    # 产 `model@v1` 的算子走哪条可服务通道；空串 = 本算子不产模型。
    # 产模型却漏设的，注册期就拒登记
    SERVING_CHANNEL: ClassVar[str] = ""
    # 引擎在 run() 之前按名注入的运行期上下文。唯一入口是 bind_runtime，
    # 名单与它的参数在注册期比对——名字打错在登记那一刻就红，不留到运行期静默
    RUNTIME_ATTRS: ClassVar[tuple[str, ...]] = (
        "tz_offset_minutes",
        "split_plan",
    )

    # 业务时区相对 UTC 的分钟偏移。⚠ 按 UTC 算时间特征会整体偏 8 小时且不报错
    tz_offset_minutes: int = 480
    # 下游切分的计划。带拟合的算子据此只在「将来会进训练集」的行上算统计量
    # （测试行参与拟合就是泄漏）；None = 图里没有切分，用整帧
    split_plan: dict[str, Any] | None = None

    def __init__(self, config: OperatorConfig) -> None:
        self.config = config

    def bind_runtime(
        self, *, tz_offset_minutes: int, split_plan: dict[str, Any] | None
    ) -> None:
        """逐项注入 `RUNTIME_ATTRS` 里的运行期上下文。

        Args: tz_offset_minutes, split_plan。
        """
        self.tz_offset_minutes = tz_offset_minutes
        self.split_plan = split_plan

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """跑这一步：吃 `{输入端口名: 负载}`，吐 `{输出端口名: 负载}`。

        Args: inputs。
        """
        raise NotImplementedError

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """给定各输入端口的列 key，答各输出端口的列 key。`None` = 推不出来。

        默认实现是**恒等**：唯一那个帧输入的列原样出现在每个帧输出上。会增删
        改列的算子必须覆盖它。
        ⚠ 这是**静态声明**，真值以运行时记下来的为准；两者对不上时发布失败并
        指名是哪一步（docs/MODELING_PLATFORM_DESIGN.md D2 / D3）。不覆盖它的
        代价不是「少一点提示」，而是入口契约算错——那会让调用方被要求提供一列
        管线自己造的东西。
        Args: config, inputs。
        """
        del config
        sources = [
            inputs.get(port.name)
            for port in cls.INPUTS
            if port.contract == CONTRACT_FRAME
        ]
        inherited = sources[0] if len(sources) == 1 else None
        return {
            port.name: inherited
            for port in cls.OUTPUTS
            if port.contract == CONTRACT_FRAME
        }

    def predict_rows(self, frame: Any) -> list[float]:
        """按拟合参数给每一行算一个预测值（产模型的算子必须实现）。

        ⚠ 训练期给测试集打分与推理期单行预测必须走**这同一个方法**：各写一份
        的话，线上与离线会算出不同的数，而两边看着都对。
        Args: frame。
        """
        raise NotImplementedError

    def dump_fitted(self) -> dict[str, Any] | None:
        """导出拟合参数（`REQUIRES_FIT=True` 必须实现）。

        ⚠ 返回值必须是纯 JSON，且**一律按列 key 建键，绝不按列索引**：训练期
        该节点在切分上游、看到的是含目标列的完整表，推理期先投影成特征列再跳过
        切分，列索引完全对不上，而错位的变换照样施加——结果是无异常、无告警的
        错误预测。契约测试扫描整数键。
        """
        return None

    def load_fitted(self, params: dict[str, Any]) -> None:
        """回灌拟合参数（推理路径）。

        Args: params。
        """
        raise NotImplementedError

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """校验一份拟合参数；不合法抛 `OperatorError`。

        ⚠ 严格度必须与 `dump_fitted` 侧对齐：校验器更严时，自己训出来的模型会
        在发布那一刻被自己拒掉。
        Args: params。
        """

    @classmethod
    def spec(cls) -> OperatorSpec:
        """完整对外描述。

        ⚠ schema 现取不落库：存 DB 会有两份，一处不同步就出现「界面上的表单和
        实际参数对不上」。
        """
        return OperatorSpec(
            code=cls.CODE,
            name=cls.NAME,
            description=cls.DESCRIPTION,
            category=cls.CATEGORY,
            spec_version=cls.SPEC_VERSION,
            icon=cls.ICON,
            inputs=list(cls.INPUTS),
            outputs=list(cls.OUTPUTS),
            config_schema=cls.CONFIG_MODEL.model_json_schema(),
            fit_required=cls.REQUIRES_FIT,
            serving_enabled=cls.ENABLED_IN_SERVING,
            serving_window_required=cls.SERVING_NEEDS_WINDOW,
            serving_channel=cls.SERVING_CHANNEL,
        )
