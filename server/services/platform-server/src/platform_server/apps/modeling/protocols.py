"""建模里五组闭合取值：运行状态、节点状态、触发来源、任务类型、服务通道。

⚠ 放开成任意字符串的话，`status` 拼成 `runing` 会照常入库、却落不进在途集合，
于是同一条流水线能同时跑两次（docs/MODELING_DESIGN.md §4.2 的 D17）。
"""

from typing import Literal, get_args

# 一次运行的生命周期。⚠ `cancelling` 是必须有的中间格：取消在下一个节点边界
# 才生效，少了它就有一段「界面说已取消、子进程还在跑」的窗口（§6.2）
RunStatus = Literal[
    "cancelled", "cancelling", "failed", "pending", "running", "succeeded"
]

RUN_STATUSES: tuple[str, ...] = tuple(sorted(get_args(RunStatus)))

# 在途：单飞的部分唯一索引只盯这三格（D17）
ACTIVE_RUN_STATUSES: tuple[str, ...] = ("cancelling", "pending", "running")

# 节点比运行多一格 `skipped`：失败即停，它后面的节点一个都没跑（D18）
NodeRunStatus = Literal[
    "cancelled",
    "cancelling",
    "failed",
    "pending",
    "running",
    "skipped",
    "succeeded",
]

NODE_RUN_STATUSES: tuple[str, ...] = tuple(sorted(get_args(NodeRunStatus)))

# 这次运行是谁发起的。⚠ 定时触发的 `schedule` 不在集合里：加它要走一次放宽
# CHECK 的迁移，而不是往库里写一个当前没有任何代码产得出的取值
RunTrigger = Literal["api", "manual"]

RUN_TRIGGERS: tuple[str, ...] = tuple(sorted(get_args(RunTrigger)))

# 建模任务类型，决定评估指标用哪一套
ModelTask = Literal["classification", "regression"]

MODEL_TASKS: tuple[str, ...] = tuple(sorted(get_args(ModelTask)))

# 拟合参数怎么带到推理侧：json = 纯数据表达，binary = 二进制产物（D9）。
# ⚠ 与 operators/base.py 的同名集合必须同集合：算子登记期按它判自己走哪条
# 通道，两侧漂了就是「算子说 binary、库把版本行拒了」
ServingChannel = Literal["binary", "json"]

SERVING_CHANNELS: tuple[str, ...] = tuple(sorted(get_args(ServingChannel)))


def sql_values(values: tuple[str, ...]) -> str:
    """把取值集合渲染成 CHECK 约束里的字面量列表。

    Args: values。
    """
    return ", ".join(f"'{value}'" for value in values)
