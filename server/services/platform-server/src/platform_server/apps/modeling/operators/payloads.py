"""非帧的两种端口负载：训练好的模型描述、评估指标。

⚠ 估计器对象**不进负载**：算子跑在子进程里，回传的只有纯数据（拟合参数 +
指标），估计器在子进程里用完即弃（docs/MODELING_DESIGN.md D12）。
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ModelPayload:
    """一个训练好的模型的纯数据描述。发布时它就是 `serving_json` 的最后一步。"""

    algo: str
    task: str
    feature_keys: tuple[str, ...]
    target_key: str
    hyper_params: dict[str, Any] = field(default_factory=dict[str, Any])
    fitted: dict[str, Any] = field(default_factory=dict[str, Any])
    # 走哪条可服务通道，取自算子的 SERVING_CHANNEL
    serving_channel: str = "json"


@dataclass(frozen=True)
class MetricsPayload:
    """一次评估的全部结果：指标 + 供画图的两组数。"""

    task: str
    metrics: dict[str, float | None] = field(
        default_factory=dict[str, float | None]
    )
    # (真实值, 预测值) 对，供散点图。有上限，超出即置 is_truncated
    pairs: tuple[tuple[float, float], ...] = ()
    is_truncated: bool = False
    # 残差直方图：(区间左端, 区间右端, 计数)
    residual_bins: tuple[tuple[float, float, int], ...] = ()
    # 混淆矩阵的类目，按升序。分类任务才有
    labels: tuple[str, ...] = ()
    # 混淆矩阵：第 i 行第 j 列 = 真实是第 i 类而判成第 j 类的行数
    matrix: tuple[tuple[int, ...], ...] = ()
