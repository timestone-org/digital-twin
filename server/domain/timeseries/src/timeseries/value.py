"""归档两列 `value_num` / `value_text` 的编解码——写侧与读侧的唯一真源。

两列的分工与「布尔量为什么进数值列」见 docs/COLLECT_DESIGN.md §3。
"""

import json
import math


def split_value(value: object) -> tuple[float | None, str | None]:
    """把一个采集值拆成归档表的 (value_num, value_text)。

    Args: value。
    """
    # ⚠ bool 是 int 的子类，先判它，1.0/0.0 才是本包钉死的口径
    if isinstance(value, bool):
        return (1.0 if value else 0.0), None
    if value is None:
        return None, None
    if isinstance(value, int | float):
        return _numeric_columns(value)
    return None, _encode_text(value)


def _numeric_columns(value: int | float) -> tuple[float | None, str | None]:
    """数值的两列取值。

    Args: value。
    """
    try:
        number = float(value)
    except OverflowError:
        # ⚠ 溢出在这里收住：抛给归档管道会让整条流卡在同一条目上重试不休。
        # 落文本列反而精确——读回来还是那个 int
        return None, _encode_text(value)
    if not math.isfinite(number):
        # ⚠ NaN/±Inf 一律当无值，只留时刻与质量位。进了 value_num 有两条后果：
        # 读侧序列化是 allow_nan=False，凡窗口内含该行的历史请求整个 500；
        # 且一个 NaN 会把它所在的聚合桶整桶算成 NaN。
        # ⚠ 也不能改落文本列——json 写出 NaN 字面量，读回来还是 nan，只换了列
        return None, None
    return number, None


def _encode_text(value: object) -> str | None:
    """非数值落文本列；编不出合法 JSON 就当无值。

    Args: value。
    """
    try:
        return json.dumps(
            value, ensure_ascii=False, default=str, allow_nan=False
        )
    except ValueError:
        # ⚠ allow_nan=False 是必须的：容器里嵌的 NaN/Inf 会被写成 `Infinity`
        # 这类**不合法 JSON**。Python 自己 loads 得回来所以往返看着是对的，
        # 但 SQL 里 value_text::jsonb 与任何非 Python 读者都会当场炸
        return None


def read_value(value_num: float | None, value_text: str | None) -> object:
    """把归档表的两列读回一个值：value_num 优先，其次解 value_text。

    Args: value_num, value_text。
    """
    # ⚠ 判 None 而不是判真假：0.0 是合法读数，判真假会让它掉进文本分支
    if value_num is not None:
        return value_num
    if value_text is None:
        return None
    try:
        decoded: object = json.loads(value_text)
    except json.JSONDecodeError:
        return value_text
    return decoded
