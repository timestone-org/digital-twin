"""可服务性门控：按预测区间宽度分档，不设硬样本数门槛。

⚠ 硬门槛回答「这个组合我见过几次」，操作员问的是「这个数我能信几分」
（AC_STARTUP_DESIGN §6.5）。区间宽度直接呈现，分档只是给人一个先验。
"""

# 分档阈值（分钟）。开机达标本身是几十分钟量级的事，区间窄于半小时可直接
# 拿来排班；宽过一小时只能当方向看
WIDTH_RELIABLE_MINUTES = 30.0
WIDTH_INDICATIVE_MINUTES = 60.0

RELIABILITY_RELIABLE = "reliable"
RELIABILITY_INDICATIVE = "indicative"
RELIABILITY_WEAK = "weak"

RELIABILITIES: frozenset[str] = frozenset(
    {RELIABILITY_RELIABLE, RELIABILITY_INDICATIVE, RELIABILITY_WEAK}
)


def reliability(interval_width_minutes: float) -> str:
    """一次预测（或一组预测的平均）的可靠性分档。

    Args: interval_width_minutes（p90 − p10）。
    """
    if interval_width_minutes <= WIDTH_RELIABLE_MINUTES:
        return RELIABILITY_RELIABLE
    if interval_width_minutes <= WIDTH_INDICATIVE_MINUTES:
        return RELIABILITY_INDICATIVE
    return RELIABILITY_WEAK
