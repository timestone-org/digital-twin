"""值语义：空、数、真假。全引擎只有这一份定义。

⚠ `is_blank` 与 `truthy` 共用同一条「空」的判据。分成两份的话，同一行数据上
`IF({开关}, …)` 走真支、`{开关} == 0` 也判真，两句自相矛盾的话同时成立
（docs/DATASET_DESIGN.md §5.2）。
"""

import math

from platform_server.apps.dataset.formula.errors import FormulaError


def is_blank(value: object) -> bool:
    """引擎眼里这个值算不算「没有」。

    ⚠ `0` 与 `False` **不是**空，只含空白的字符串**是**空。
    Args: value。
    """
    if value is None:
        return True
    return isinstance(value, str) and not value.strip()


def to_number(value: object, *, where: str = "运算") -> float | None:
    """转成 float。空 → None，NaN 与 ±inf 也 → None（不是错），转不动才报错。

    ⚠ 401 位整数字面量 `float()` 抛的是 `OverflowError` 而不是 `ValueError`，
    漏接就穿透成 500；NaN/inf 放行则会算进 `computed_json`，而 PG 的 jsonb
    拒收它们，整行写入就此永久失败（docs/DATASET_DESIGN.md §5.2）。
    Args: value, where（报错文案里指出是哪一步）。
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return _finite_or_blank(value, where=where)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        return _from_text(text, original=value, where=where)
    raise FormulaError(f"{where}遇到不支持的值类型 {type(value).__name__}")


def truthy(value: object) -> bool | None:
    """真假判断，空 → None（未知）。

    字符串走**数值口径**：能转数就按数论真假，转不动才按「有没有内容」。
    ⚠ 转不成数的文本（「停机」）判**真**且不报错——条件位上抛错会让一格脏
    数据废掉整列（docs/DATASET_DESIGN.md §5.2）。
    Args: value。
    """
    if is_blank(value):
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return _text_truthy(value)
    return bool(value)


def finite(value: float) -> float | None:
    """非有限即空——inf/NaN 落进 jsonb 会被 PG 拒收，绝不能往外传。

    Args: value。
    """
    return None if math.isnan(value) or math.isinf(value) else value


def finite_constant(value: object) -> object:
    """字面量守门：落不了库的数值常量当场报错，其余原样放行。

    ⚠ `1e400` 求值出来是 `Infinity`，`json.dumps` 照写不误，而 jsonb 拒收，
    表现是这张表从此写一行 500 一次（docs/DATASET_DESIGN.md §5.2）。
    Args: value。
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    if _finite_or_blank(value, where="公式") is None:
        raise FormulaError("公式里的数值超出可表示范围")
    return value


def numbers_of(values: list[object], where: str) -> list[float]:
    """标量聚合用：逐个转数字并跳过空值。

    Args: values, where。
    """
    found: list[float] = []
    for item in values:
        number = to_number(item, where=where)
        if number is not None:
            found.append(number)
    return found


def _finite_or_blank(value: float, *, where: str) -> float | None:
    """数值 → float，非有限当空；超出 float 范围报错。

    Args: value, where。
    """
    try:
        number = float(value)
    except OverflowError as error:
        raise FormulaError(f"{where}遇到超出可表示范围的数值") from error
    return finite(number)


def _from_text(text: str, *, original: str, where: str) -> float | None:
    """已 strip 且非空的文本 → float；转不动报错。

    Args: text, original（报错里回显用户写的原样）, where。
    """
    try:
        number = float(text)
    except ValueError as error:
        raise FormulaError(f"{where}遇到非数字值 '{original}'") from error
    except OverflowError as error:
        raise FormulaError(f"{where}遇到超出可表示范围的数值") from error
    return finite(number)


def _text_truthy(value: str) -> bool | None:
    """文本的真假：先按数论，转不动的文本算真。

    Args: value。
    """
    try:
        number = float(value.strip())
    except (ValueError, OverflowError):
        return True
    # 与 to_number 同口径：文本里的 nan / inf 也当空值，即未知
    return None if finite(number) is None else number != 0
