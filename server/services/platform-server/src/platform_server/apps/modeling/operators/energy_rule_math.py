"""能源规则的有界十进制输入与输出。"""

from collections.abc import Mapping
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from platform_server.apps.modeling.operators.base import OperatorError

MAX_RULE_VALUE = Decimal("1e30")
MIN_RULE_VALUE = Decimal("1e-30")
MAX_RULE_INPUT_LENGTH = 128
DECIMAL_WORK_PRECISION = 96
PERCENT = Decimal("100")


def number_of(row: Mapping[str, object], key: str) -> Decimal:
    """获取有限且有界的十进制观测；Args: row, key。"""
    raw = row.get(key)
    if isinstance(raw, str) and len(raw) > MAX_RULE_INPUT_LENGTH:
        raise OperatorError(f"指标「{key}」的数值文本过长")
    if isinstance(raw, bool) or not isinstance(raw, (str, float, int, Decimal)):
        raise OperatorError(f"指标「{key}」必须是有效数值")
    try:
        value = Decimal(str(raw))
    except InvalidOperation as error:
        raise OperatorError(f"指标「{key}」必须是有效数值") from error
    if not value.is_finite() or abs(value) > MAX_RULE_VALUE:
        raise OperatorError(f"指标「{key}」必须是有限且有界的数值")
    if value and abs(value) < MIN_RULE_VALUE:
        raise OperatorError(f"指标「{key}」超出支持的数值精度")
    return value


def nonnegative_of(row: Mapping[str, object], key: str) -> Decimal:
    """获取不允许负值的计量；Args: row, key。"""
    value = number_of(row, key)
    if value < 0:
        raise OperatorError(f"指标「{key}」不能为负值")
    return value


def divide(numerator: Decimal, denominator: Decimal) -> Decimal:
    """分母必须为正，禁止将无法核算伪装成零；Args: numerator, denominator。"""
    if denominator <= 0:
        raise OperatorError("分母必须大于零，当前观测无法核算")
    return numerator / denominator


def decimal_text(value: Decimal, places: int) -> str:
    """按冻结的小数位数四舍五入；Args: value, places。"""
    quantized = value.quantize(
        Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP
    )
    if quantized == 0:
        return "0"
    return (
        format(quantized, "f").rstrip("0").rstrip(".")
        if places
        else format(quantized, "f")
    )
