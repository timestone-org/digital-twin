"""算子注册表：进程内单例，登记即校验。

⚠ 重名不许静默覆盖——参考实现是告警后覆盖，加算子时打错一个字符会悄悄顶掉
别的算子而 CI 全绿（docs/MODELING_DESIGN.md §5.6）。
"""

import inspect

from platform_server.apps.modeling.operators.base import (
    CATEGORIES,
    CONTRACT_MODEL,
    CONTRACTS,
    PREFETCHED_KEY,
    SERVING_CHANNELS,
    OperatorBase,
    OperatorConfig,
    OperatorSpec,
    PortSpec,
)


class OperatorRegistryError(Exception):
    """算子登记不合法。进程启动即抛，不留到运行期。"""


class OperatorRegistry:
    """按 code 索引算子类。"""

    def __init__(self) -> None:
        self._classes: dict[str, type[OperatorBase]] = {}

    def register(self, operator: type[OperatorBase]) -> type[OperatorBase]:
        """登记一个算子类，逐项校验元数据。

        Args: operator。
        """
        _check(operator)
        if operator.CODE in self._classes:
            raise OperatorRegistryError(f"算子码重复：{operator.CODE}")
        self._classes[operator.CODE] = operator
        return operator

    def get(self, code: str) -> type[OperatorBase]:
        """按 code 取算子类；不认识就抛。

        Args: code。
        """
        operator = self._classes.get(code)
        if operator is None:
            raise OperatorRegistryError(f"未知算子「{code}」")
        return operator

    def has(self, code: str) -> bool:
        """认不认识这个 code。

        Args: code。
        """
        return code in self._classes

    def codes(self) -> tuple[str, ...]:
        """全部算子码，按字典序。"""
        return tuple(sorted(self._classes))

    def specs(self) -> list[OperatorSpec]:
        """全部算子的完整描述，按分类与 code 排序。"""
        order = {name: index for index, name in enumerate(CATEGORIES)}
        classes = sorted(
            self._classes.values(),
            key=lambda item: (order[item.CATEGORY], item.CODE),
        )
        return [item.spec() for item in classes]

    def build(
        self, code: str, config: dict[str, object]
    ) -> tuple[OperatorBase, OperatorConfig]:
        """按 code 与一份参数造一个算子实例。参数不合法由 pydantic 抛。

        Args: code, config。
        """
        operator = self.get(code)
        parsed = operator.CONFIG_MODEL.model_validate(config)
        return operator(parsed), parsed


registry = OperatorRegistry()


def register_operator(operator: type[OperatorBase]) -> type[OperatorBase]:
    """登记进进程内单例注册表的装饰器。

    Args: operator。
    """
    return registry.register(operator)


def _check(operator: type[OperatorBase]) -> None:
    """登记期的全部校验。这几项打错名字在运行期都是静默的。

    Args: operator。
    """
    if not operator.CODE or not operator.NAME or not operator.ICON:
        raise OperatorRegistryError(f"{operator.__name__} 缺 CODE/NAME/ICON")
    if operator.CATEGORY not in CATEGORIES:
        raise OperatorRegistryError(
            f"{operator.CODE} 的分类「{operator.CATEGORY}」不在名单里"
        )
    _check_ports(operator.CODE, operator.INPUTS, "输入")
    _check_ports(operator.CODE, operator.OUTPUTS, "输出")
    _check_serving_channel(operator)
    _check_runtime_attrs(operator)


def _check_ports(code: str, ports: tuple[PortSpec, ...], side: str) -> None:
    names = [port.name for port in ports]
    if len(names) != len(set(names)):
        raise OperatorRegistryError(f"{code} 的{side}端口名重复")
    if PREFETCHED_KEY in names:
        raise OperatorRegistryError(
            f"{code} 的{side}端口占用了引擎的保留键 {PREFETCHED_KEY}"
        )
    for port in ports:
        if port.contract not in CONTRACTS:
            raise OperatorRegistryError(
                f"{code} 的端口「{port.name}」用了未知契约 {port.contract}"
            )


def _check_serving_channel(operator: type[OperatorBase]) -> None:
    """产模型的算子必须声明走哪条通道，不产模型的必须留空。

    ⚠ 漏设在运行期是静默的：发布时会把一个根本没有可服务表示的版本标成可上线。
    Args: operator。
    """
    produces_model = any(
        port.contract == CONTRACT_MODEL for port in operator.OUTPUTS
    )
    channel = operator.SERVING_CHANNEL
    if produces_model and channel not in SERVING_CHANNELS:
        raise OperatorRegistryError(
            f"{operator.CODE} 产出模型却没声明可服务通道"
        )
    if not produces_model and channel:
        raise OperatorRegistryError(
            f"{operator.CODE} 不产出模型，不该声明可服务通道"
        )


def _check_runtime_attrs(operator: type[OperatorBase]) -> None:
    """注入名单必须与 `bind_runtime` 的形参一一对上。

    ⚠ 对不上时运行期不报错，只是那一项永远是基类默认值：时间特征按 UTC 算差
    8 小时、拟合统计量按整帧算（测试集泄漏），两者都不报错。
    Args: operator。
    """
    parameters = inspect.signature(operator.bind_runtime).parameters
    declared = set(operator.RUNTIME_ATTRS)
    accepted = {name for name in parameters if name != "self"}
    if declared != accepted:
        raise OperatorRegistryError(
            f"{operator.CODE} 的 RUNTIME_ATTRS 与 bind_runtime 形参对不上："
            f"{sorted(declared)} vs {sorted(accepted)}"
        )
    missing = declared - set(vars(OperatorBase))
    if missing:
        raise OperatorRegistryError(
            f"{operator.CODE} 的 RUNTIME_ATTRS 里 {sorted(missing)} 没有默认值"
        )
