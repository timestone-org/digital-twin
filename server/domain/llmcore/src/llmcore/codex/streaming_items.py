"""缓存已完成输出项，在响应终态补齐缺项并校验重复身份。"""

from dataclasses import dataclass, field

from openai.types.responses import (
    Response,
    ResponseOutputItemAddedEvent,
    ResponseOutputItemDoneEvent,
)
from openai.types.responses.response_output_item import ResponseOutputItem

from llmcore.errors import ModelUnavailable


@dataclass
class OutputItems:
    """一次响应中按原始输出位置保存的完整输出项。"""

    items: dict[int, ResponseOutputItem] = field(
        default_factory=dict[int, ResponseOutputItem]
    )
    positions: dict[tuple[str, str], int] = field(
        default_factory=dict[tuple[str, str], int]
    )

    def added(self, event: ResponseOutputItemAddedEvent) -> None:
        """只保留未完成项的位置，绝不将其作为执行输出。Args: event。"""
        self._remember_position(event.item, event.output_index)

    def record(self, event: ResponseOutputItemDoneEvent) -> bool:
        """重复完整项只登记一次，冲突拒绝。Args: event。"""
        prior = self.items.get(event.output_index)
        if prior is not None:
            _check_same(prior, event.item)
            return False
        self._remember_position(event.item, event.output_index)
        self.items[event.output_index] = event.item
        return True

    def _remember_position(self, item: ResponseOutputItem, index: int) -> None:
        identity = _identity(item)
        prior = self.positions.get(identity)
        if prior is not None and prior != index:
            raise ModelUnavailable("模型输出项身份对应了多个位置")
        if any(
            key != identity and position == index
            for key, position in self.positions.items()
        ):
            raise ModelUnavailable("模型同一输出位置对应了多个身份")
        self.positions[identity] = index

    def merge(self, response: Response) -> Response:
        """终态已有项与完成回执必须相同，缺项按原始位置补齐。Args: response。"""
        output = list(response.output)
        identities = [_identity(item) for item in output]
        if len(set(identities)) != len(identities):
            raise ModelUnavailable("模型终态输出项身份重复")
        indices = self.positions
        ordered = [indices[key] for key in identities if key in indices]
        if ordered != sorted(ordered):
            raise ModelUnavailable("模型终态输出项顺序与完成回执不一致")
        for index, item in sorted(self.items.items()):
            identity = _identity(item)
            if identity in identities:
                _check_same(item, output[identities.index(identity)])
            else:
                position = next(
                    (
                        position
                        for position, key in enumerate(identities)
                        if key in indices and indices[key] > index
                    ),
                    len(output),
                )
                output.insert(position, item)
                identities.insert(position, identity)
        if any(
            key[0] == "function_call" and key not in identities
            for key in self.positions
        ):
            raise ModelUnavailable("模型已声明的工具调用未完整返回")
        return response.model_copy(update={"output": output})


def _identity(item: ResponseOutputItem) -> tuple[str, str]:
    """输出项类型与稳定身份。Args: item。"""
    identity = getattr(item, "id", None)
    if not identity and item.type == "function_call":
        identity = item.call_id
    if not isinstance(identity, str) or not identity:
        raise ModelUnavailable("模型输出项身份缺失")
    return item.type, identity


def _check_same(left: ResponseOutputItem, right: ResponseOutputItem) -> None:
    """同一项的完整回执不得互相矛盾。Args: left, right。"""
    if left.model_dump_json(exclude_none=True) != right.model_dump_json(
        exclude_none=True
    ):
        raise ModelUnavailable("模型已完成输出项与终态内容不一致")
