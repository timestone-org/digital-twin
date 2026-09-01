"""子进程侧入口：跑一个算子实例。

⚠ 必须是**模块级纯函数**：pickle 只认模块级名字，闭包与实例方法交不进进程池。
⚠ 子进程是全新解释器，先 import 一次算子包触发注册，再按 code 取类
（docs/MODELING_DESIGN.md D17b）。
"""

from dataclasses import dataclass
from typing import Any

from platform_server.apps.modeling.operators import registry


@dataclass(frozen=True)
class NodePayload:
    """交给子进程的一整包。全是纯数据，跨进程可 pickle。"""

    operator: str
    config: dict[str, Any]
    inputs: dict[str, Any]
    tz_offset_minutes: int
    split_plan: dict[str, Any] | None


def run_node_payload(payload: NodePayload) -> dict[str, Any]:
    """在子进程里跑一个算子并回它的输出。

    ⚠ 回传的必须是纯数据：帧是 dict / list，模型端口装的是可服务表示而不是
    估计器对象——估计器在子进程里用完即弃。
    Args: payload。
    """
    operator, _ = registry.build(payload.operator, payload.config)
    operator.bind_runtime(
        tz_offset_minutes=payload.tz_offset_minutes,
        split_plan=payload.split_plan,
    )
    return operator.run(payload.inputs)
