"""时序分块 K 折 —— 评估的折外预测按它切。

⚠ 不随机打乱：运行模式在迁移（AC_STARTUP_DESIGN §2），随机折会把未来的模式
泄给过去，指标虚高且方向不可知。
"""

_MIN_FOLDS = 2
_MIN_SAMPLES = 2


def time_fold_ids(count: int, folds: int) -> list[int]:
    """按时间序切成连续块，返回每条样本的折号（样本已按时刻升序）。

    块尽量等长，余数摊给靠前的块；样本数少于折数时折数收缩到样本数。
    Args: count, folds。
    """
    if folds < _MIN_FOLDS:
        raise ValueError("折数至少是 2")
    if count < _MIN_SAMPLES:
        raise ValueError("样本至少要 2 条才能切折")
    actual = min(folds, count)
    base, extra = divmod(count, actual)
    ids: list[int] = []
    for fold in range(actual):
        length = base + (1 if fold < extra else 0)
        ids.extend([fold] * length)
    return ids
