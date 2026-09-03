"""子进程侧入口：跑一个算子实例，并把发布件要用的三样东西一起交回来。

⚠ 必须是**模块级纯函数**：pickle 只认模块级名字，闭包与实例方法交不进进程池。
⚠ 子进程是全新解释器，先 import 一次算子包触发注册，再按 code 取类
（docs/MODELING_DESIGN.md D17b）。
⚠ 拟合参数与逐步列集**必须在这里回传**：算子实例用完即弃，它学到的东西不跟着
输出走，留在子进程里就再也拿不回来了（docs/MODELING_PLATFORM_DESIGN.md D1）。
"""

from dataclasses import dataclass, field
from typing import Any

from platform_server.apps.modeling.operators import Frame, registry


@dataclass(frozen=True)
class NodePayload:
    """交给子进程的一整包。全是纯数据，跨进程可 pickle。"""

    operator: str
    config: dict[str, Any]
    inputs: dict[str, Any]
    tz_offset_minutes: int
    split_plan: dict[str, Any] | None


@dataclass(frozen=True)
class NodeResult:
    """一个算子跑完交回来的全部东西。全是纯数据，跨进程可 pickle。"""

    #: 按输出端口建键的负载
    outputs: dict[str, Any]
    #: 这一步学到的参数，按列 key 建键；不带拟合的算子是 `None`
    fitted: dict[str, Any] | None = None
    #: `{"inputs": {端口: [列 key…]}, "outputs": {端口: [列 key…]}}`
    io: dict[str, dict[str, list[str]]] = field(
        default_factory=dict[str, dict[str, list[str]]]
    )


def run_node_payload(payload: NodePayload) -> NodeResult:
    """在子进程里跑一个算子并回它的输出、拟合参数与逐端口列集。

    ⚠ 回传的必须是纯数据：帧是 dict / list，模型端口装的是可服务表示而不是
    估计器对象——估计器在子进程里用完即弃。
    Args: payload。
    """
    operator, _ = registry.build(payload.operator, payload.config)
    operator.bind_runtime(
        tz_offset_minutes=payload.tz_offset_minutes,
        split_plan=payload.split_plan,
    )
    outputs = operator.run(payload.inputs)
    return NodeResult(
        outputs=outputs,
        fitted=operator.dump_fitted(),
        io={
            "inputs": _keys_by_port(payload.inputs),
            "outputs": _keys_by_port(outputs),
        },
    )


def _keys_by_port(values: dict[str, Any]) -> dict[str, list[str]]:
    """端口上装的是帧时，记下它的列 key 与顺序；不是帧的端口不记。

    Args: values。
    """
    return {
        port: list(value.keys)
        for port, value in values.items()
        if isinstance(value, Frame)
    }
