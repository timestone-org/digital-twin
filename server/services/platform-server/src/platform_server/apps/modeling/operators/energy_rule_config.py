"""能源规则的有界参数、计量分类与有向流量拓扑。"""

from decimal import Decimal
from typing import Literal, Self

from pydantic import Field, model_validator

from platform_server.apps.modeling.operators.base import OperatorConfig

type EnergyRuleKind = Literal[
    "hvac_compliance",
    "efficiency_fluctuation",
    "energy_aggregation",
    "energy_trace",
    "unit_consumption",
    "efficiency_benchmark",
    "equipment_efficiency",
    "supply_diagnosis",
]

TASK_RULES = "rule_calculation"
MAX_RULE_ITEMS = 32
MAX_TRACE_NODES = 32
MAX_TRACE_PATHS = 256
MAX_FIELD_MAPPINGS = 16
MAX_FIELD_NAME_LENGTH = 128


class EnergyRuleParameters(OperatorConfig):
    """规则阈值与十进制显示精度。"""

    temperature_min: float = Field(default=18, ge=-100, le=100)
    temperature_max: float = Field(default=26, ge=-100, le=100)
    humidity_min: float = Field(default=40, ge=0, le=100)
    humidity_max: float = Field(default=65, ge=0, le=100)
    fluctuation_threshold_pct: float = Field(default=10, ge=0, le=10000)
    benchmark_good_ratio: float = Field(default=1, gt=0, le=100)
    benchmark_warning_ratio: float = Field(default=1.1, gt=0, le=100)
    cop_min: float = Field(default=3.2, gt=0, le=100)
    balance_tolerance: float = Field(default=0.01, ge=0, le=1000000)
    voltage_min: float = Field(default=209, ge=0, le=1000000)
    voltage_max: float = Field(default=231, ge=0, le=1000000)
    frequency_min: float = Field(default=49.5, ge=0, le=1000)
    frequency_max: float = Field(default=50.5, ge=0, le=1000)
    pressure_min: float = Field(default=0.45, ge=0, le=1000000)
    pressure_max: float = Field(default=0.7, ge=0, le=1000000)
    flow_min: float = Field(default=80, ge=0, le=1000000000)
    flow_max: float = Field(default=120, ge=0, le=1000000000)
    decimal_places: int = Field(default=6, ge=0, le=12)

    @model_validator(mode="after")
    def check_order(self) -> Self:
        """上下限必须保持顺序。"""
        prefixes = (
            "temperature",
            "humidity",
            "voltage",
            "frequency",
            "pressure",
            "flow",
        )
        values = self.model_dump()
        for prefix in prefixes:
            if values[f"{prefix}_min"] > values[f"{prefix}_max"]:
                raise ValueError("规则下限不能大于上限")
        if self.benchmark_good_ratio > self.benchmark_warning_ratio:
            raise ValueError("对标良好边界不能大于预警边界")
        return self


class EnergyMeter(OperatorConfig):
    """一个计量列的类别、单位与用户确认的折标系数。"""

    category: str = Field(min_length=1, max_length=64)
    column: str = Field(min_length=1, max_length=128)
    unit: str = Field(default="kWh", min_length=1, max_length=32)
    standard_coal_factor: Decimal = Field(
        default=Decimal("0.1229"),
        ge=Decimal("1e-12"),
        le=1000000,
        max_digits=20,
        decimal_places=12,
    )


class EnergyFlowEdge(OperatorConfig):
    """来源端计量的有向能流边与传输效率。"""

    source: str = Field(min_length=1, max_length=64)
    target: str = Field(min_length=1, max_length=64)
    column: str = Field(min_length=1, max_length=128)
    efficiency: Decimal = Field(
        default=Decimal("1"),
        ge=Decimal("1e-12"),
        le=1,
        max_digits=13,
        decimal_places=12,
    )
    unit: str = Field(default="kWh", min_length=1, max_length=32)


class EnergyRulesConfig(OperatorConfig):
    """八种能源业务规则及其可复现配置。"""

    kind: EnergyRuleKind = Field(
        default="hvac_compliance",
        title="规则类型",
        description=(
            "hvac_compliance=空调机组达标检测；"
            "efficiency_fluctuation=能效波动分析；"
            "energy_aggregation=能耗分类归集；"
            "energy_trace=能源流向追溯；"
            "unit_consumption=单位能耗核算；"
            "efficiency_benchmark=能效对标分析；"
            "equipment_efficiency=设备能效评估；"
            "supply_diagnosis=能源供应异常诊断"
        ),
    )
    fields: dict[str, str] = Field(
        default_factory=dict[str, str],
        max_length=MAX_FIELD_MAPPINGS,
        title="业务列映射",
        description="按规则配置业务指标到台账列；留空采用默认中文列名。",
        json_schema_extra={"x-dt-widget": "energy-rules-json"},
    )
    parameters: EnergyRuleParameters = Field(
        default_factory=EnergyRuleParameters,
        title="业务参数",
        description="阈值、守恒容差及计算精度。",
        json_schema_extra={"x-dt-widget": "energy-rules-json"},
    )
    meters: list[EnergyMeter] = Field(
        default_factory=list[EnergyMeter],
        max_length=MAX_RULE_ITEMS,
        title="分类计量",
        description="同期间消耗量（非累计表读数）每列只归集一次；折标系数须由业务确认。",
        json_schema_extra={"x-dt-widget": "energy-rules-json"},
    )
    topology: list[EnergyFlowEdge] = Field(
        default_factory=list[EnergyFlowEdge],
        max_length=MAX_RULE_ITEMS,
        title="能源流向",
        description="来源端同期间能量的有向无环拓扑；所有边须统一能源单位。",
        json_schema_extra={"x-dt-widget": "energy-rules-json"},
    )

    @model_validator(mode="after")
    def check_business_config(self) -> Self:
        """配置边界在运行前一次性校验。"""
        allowed = {key for key, _ in default_fields(self.kind)}
        if set(self.fields) - allowed:
            raise ValueError("列映射含有不属于该规则的指标")
        if any(
            not value.strip() or len(value) > MAX_FIELD_NAME_LENGTH
            for value in self.fields.values()
        ):
            raise ValueError("业务列名不能为空且至多128字符")
        columns = [
            self.fields.get(key, name)
            for key, name in default_fields(self.kind)
        ]
        if len(columns) != len(set(columns)):
            raise ValueError("不同业务指标不能使用同一列")
        meter_columns = [meter.column for meter in self.meters]
        if len(meter_columns) != len(set(meter_columns)):
            raise ValueError("计量列不能重复归集")
        validate_topology(self.topology)
        return self


def default_fields(kind: EnergyRuleKind) -> tuple[tuple[str, str], ...]:
    """规则业务字段的稳定顺序；Args: kind。"""
    fields: dict[EnergyRuleKind, tuple[tuple[str, str], ...]] = {
        "hvac_compliance": (("temperature", "温度"), ("humidity", "湿度")),
        "efficiency_fluctuation": (
            ("current_efficiency", "当前能效"),
            ("reference_efficiency", "基准能效"),
        ),
        "energy_aggregation": (),
        "energy_trace": (),
        "unit_consumption": (("energy", "能耗"), ("output", "产量")),
        "efficiency_benchmark": (
            ("actual_intensity", "实际单位能耗"),
            ("benchmark_intensity", "对标单位能耗"),
        ),
        "equipment_efficiency": (
            ("useful_output", "制冷量"),
            ("input_power", "输入功率"),
        ),
        "supply_diagnosis": (
            ("voltage", "电压"),
            ("frequency", "频率"),
            ("pressure", "压力"),
            ("flow", "流量"),
        ),
    }
    return fields[kind]


def configured_meters(config: EnergyRulesConfig) -> tuple[EnergyMeter, ...]:
    """解析显式分类计量或电力默认分类；Args: config。"""
    if config.meters:
        return tuple(config.meters)
    return tuple(
        EnergyMeter(category=category, column=f"{category}电量")
        for category in ("生产", "空调", "照明")
    )


def configured_topology(
    config: EnergyRulesConfig,
) -> tuple[EnergyFlowEdge, ...]:
    """解析显式能源拓扑或单一进线默认拓扑；Args: config。"""
    if config.topology:
        return tuple(config.topology)
    return (
        EnergyFlowEdge(source="进线", target="配电中心", column="总供能"),
        *(
            EnergyFlowEdge(source="配电中心", target=name, column=f"{name}供能")
            for name in ("生产", "空调", "照明")
        ),
    )


def required_columns(config: EnergyRulesConfig) -> tuple[str, ...]:
    """按配置获取部署入口的稳定列序；Args: config。"""
    if config.kind == "energy_aggregation":
        return tuple(meter.column for meter in configured_meters(config))
    if config.kind == "energy_trace":
        return tuple(edge.column for edge in configured_topology(config))
    return tuple(
        config.fields.get(key, name)
        for key, name in default_fields(config.kind)
    )


def topology_order(edges: tuple[EnergyFlowEdge, ...]) -> tuple[str, ...]:
    """拓扑排序并拒绝环路；Args: edges。"""
    nodes = tuple(
        dict.fromkeys(
            node for edge in edges for node in (edge.source, edge.target)
        )
    )
    if len(nodes) > MAX_TRACE_NODES:
        raise ValueError("能源流向节点数量超过上限")
    incoming = {
        node: sum(edge.target == node for edge in edges) for node in nodes
    }
    ready = [node for node in nodes if incoming[node] == 0]
    ordered: list[str] = []
    while ready:
        node = ready.pop(0)
        ordered.append(node)
        for edge in edges:
            if edge.source == node:
                incoming[edge.target] -= 1
                if incoming[edge.target] == 0:
                    ready.append(edge.target)
    if len(ordered) != len(nodes):
        raise ValueError("能源流向不能包含环路")
    return tuple(ordered)


def validate_topology(edges: list[EnergyFlowEdge]) -> None:
    """拒绝重复计量、混合单位与环路；Args: edges。"""
    columns = [edge.column for edge in edges]
    pairs = [(edge.source, edge.target) for edge in edges]
    if len(columns) != len(set(columns)) or len(pairs) != len(set(pairs)):
        raise ValueError("能源流向不能重复计量列或边")
    if len({edge.unit for edge in edges}) > 1:
        raise ValueError("能源流向必须先统一能源计量单位")
    order = topology_order(tuple(edges))
    _check_path_count(tuple(edges), order)


def _check_path_count(
    edges: tuple[EnergyFlowEdge, ...], order: tuple[str, ...]
) -> None:
    paths: dict[str, int] = {}
    for node in order:
        parents = [edge.source for edge in edges if edge.target == node]
        paths[node] = sum(paths[parent] for parent in parents) if parents else 1
    sources = {edge.source for edge in edges}
    total = sum(count for node, count in paths.items() if node not in sources)
    if total > MAX_TRACE_PATHS:
        raise ValueError("能源流向路径数量超过上限")
