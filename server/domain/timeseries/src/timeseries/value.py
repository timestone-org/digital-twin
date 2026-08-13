"""归档两列 `value_num` / `value_text` 的编解码——写侧与读侧的唯一真源。

两列的分工与「布尔量为什么进数值列」见 docs/COLLECT_DESIGN.md §3。
"""

import json


def split_value(value: object) -> tuple[float | None, str | None]:
    """把一个采集值拆成归档表的 (value_num, value_text)。

    Args: value。
    """
    # ⚠ bool 是 int 的子类，必须排在数值之前：调换顺序后 1.0/0.0 就由
    # float(True) 决定，而不是由这里写死
    if isinstance(value, bool):
        return (1.0 if value else 0.0), None
    if isinstance(value, int | float):
        return float(value), None
    if value is None:
        return None, None
    return None, json.dumps(value, ensure_ascii=False, default=str)


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
