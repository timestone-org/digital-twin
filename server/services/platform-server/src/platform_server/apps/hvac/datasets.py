"""空调数据集与指标目录 —— 外部数据源形状的唯一真源。

它描述的是厂商 EMS 库里那些视图的列口径，随代码走版本，故是常量表不是数据库表。
口径与扩展方式见 docs/AC_DATA_DESIGN.md §4。
"""

from dataclasses import dataclass

# 本期唯一的数据集。加一个数据集 = 往 DATASETS 里加一项，前端不用改
DATASET_RAW_MINUTE = "raw_minute"

# 外部视图里的时间列名，与 19 个指标列同属外部既成事实
SOURCE_TIME_COLUMN = "CT"

UNIT_CELSIUS = "℃"
UNIT_PERCENT = "%"
UNIT_KILOPASCAL = "kPa"
UNIT_HERTZ = "Hz"

GROUP_TEMPERATURE = "temperature"
GROUP_HUMIDITY = "humidity"
GROUP_PRESSURE = "pressure"
GROUP_FREQUENCY = "frequency"


@dataclass(frozen=True)
class MetricSpec:
    """数据集里的一个可读量。

    `group` 决定前端画到哪条 Y 轴；`is_limitable` 决定台账页给不给它配达标范围；
    `is_charted_by_default` 决定折线图初始画哪几条。
    """

    key: str
    name: str
    unit: str
    group: str
    is_limitable: bool = False
    is_charted_by_default: bool = False


@dataclass(frozen=True)
class DatasetSpec:
    """一台空调可看的一类数据。"""

    key: str
    name: str
    description: str
    metrics: tuple[MetricSpec, ...]


RAW_MINUTE_METRICS: tuple[MetricSpec, ...] = (
    MetricSpec(
        key="workshop_temp_avg",
        name="车间温度平均值",
        unit=UNIT_CELSIUS,
        group=GROUP_TEMPERATURE,
        is_limitable=True,
        is_charted_by_default=True,
    ),
    MetricSpec(
        key="workshop_humidity_avg",
        name="车间湿度平均值",
        unit=UNIT_PERCENT,
        group=GROUP_HUMIDITY,
        is_limitable=True,
        is_charted_by_default=True,
    ),
    MetricSpec(
        key="ac_temp_setpoint",
        name="温度设定值",
        unit=UNIT_CELSIUS,
        group=GROUP_TEMPERATURE,
        is_charted_by_default=True,
    ),
    MetricSpec(
        key="ac_humidity_setpoint",
        name="湿度设定值",
        unit=UNIT_PERCENT,
        group=GROUP_HUMIDITY,
        is_charted_by_default=True,
    ),
    MetricSpec(
        key="fresh_air_temp",
        name="新风温度",
        unit=UNIT_CELSIUS,
        group=GROUP_TEMPERATURE,
    ),
    MetricSpec(
        key="fresh_air_humidity",
        name="新风湿度",
        unit=UNIT_PERCENT,
        group=GROUP_HUMIDITY,
    ),
    MetricSpec(
        key="supply_air_temp",
        name="送风温度",
        unit=UNIT_CELSIUS,
        group=GROUP_TEMPERATURE,
    ),
    MetricSpec(
        key="supply_air_humidity",
        name="送风湿度",
        unit=UNIT_PERCENT,
        group=GROUP_HUMIDITY,
    ),
    MetricSpec(
        key="return_air_temp",
        name="回风温度",
        unit=UNIT_CELSIUS,
        group=GROUP_TEMPERATURE,
    ),
    MetricSpec(
        key="return_air_humidity",
        name="回风湿度",
        unit=UNIT_PERCENT,
        group=GROUP_HUMIDITY,
    ),
    MetricSpec(
        key="mixed_air_temp",
        name="混风温度",
        unit=UNIT_CELSIUS,
        group=GROUP_TEMPERATURE,
    ),
    MetricSpec(
        key="mixed_air_humidity",
        name="混风湿度",
        unit=UNIT_PERCENT,
        group=GROUP_HUMIDITY,
    ),
    MetricSpec(
        key="chilled_water_supply_temp",
        name="冷冻水供水温度",
        unit=UNIT_CELSIUS,
        group=GROUP_TEMPERATURE,
    ),
    MetricSpec(
        key="chilled_water_supply_pressure",
        name="冷冻水供水压力",
        unit=UNIT_KILOPASCAL,
        group=GROUP_PRESSURE,
    ),
    MetricSpec(
        key="heat_steam_temp",
        name="加热蒸汽温度",
        unit=UNIT_CELSIUS,
        group=GROUP_TEMPERATURE,
    ),
    MetricSpec(
        key="heat_steam_pressure",
        name="加热蒸汽压力",
        unit=UNIT_KILOPASCAL,
        group=GROUP_PRESSURE,
    ),
    MetricSpec(
        key="humidify_steam_temp",
        name="加湿蒸汽温度",
        unit=UNIT_CELSIUS,
        group=GROUP_TEMPERATURE,
    ),
    MetricSpec(
        key="humidify_steam_pressure",
        name="加湿蒸汽压力",
        unit=UNIT_KILOPASCAL,
        group=GROUP_PRESSURE,
    ),
    MetricSpec(
        key="fan_frequency",
        name="送风机频率",
        unit=UNIT_HERTZ,
        group=GROUP_FREQUENCY,
    ),
)

DATASETS: tuple[DatasetSpec, ...] = (
    DatasetSpec(
        key=DATASET_RAW_MINUTE,
        name="原始数据",
        description="逐分钟记录的 19 个测点原值，来自现场能源管理系统",
        metrics=RAW_MINUTE_METRICS,
    ),
)

_BY_KEY = {dataset.key: dataset for dataset in DATASETS}


def find_dataset(key: str) -> DatasetSpec | None:
    """按 key 取数据集，没有就给 None。

    Args: key。
    """
    return _BY_KEY.get(key)


def dataset_keys() -> frozenset[str]:
    """全部数据集的 key，建表约束与入参校验共用它。"""
    return frozenset(_BY_KEY)


def metric_keys(dataset: DatasetSpec) -> tuple[str, ...]:
    """一个数据集的全部指标 key，顺序即展示顺序。

    Args: dataset。
    """
    return tuple(metric.key for metric in dataset.metrics)


def limitable_metric_keys() -> frozenset[str]:
    """全部可配达标范围的指标 key。

    ⚠ 达标范围表是按「指标 → 上下限」存的，与数据集无关：同一个指标出现在两个
    数据集里时，它的达标范围只有一份。
    """
    return frozenset(
        metric.key
        for dataset in DATASETS
        for metric in dataset.metrics
        if metric.is_limitable
    )
