"""列配置的合法性检查：来源与它必需的那几项要对得上。"""

from lib.errors.base import FieldError
from platform_server.apps.dataset.errors import DatasetColumnInvalid
from platform_server.apps.dataset.protocols import ColumnSource
from timeseries import InvalidNodeKey, split_node_key

_MISSING_MESSAGE = "点位汇总列必须绑定一个点位"
_SHAPE_MESSAGE = "点位身份的形状应为「数据源 id : 点位编码」"
_NO_FORMULA_MESSAGE = "公式列必须写一条公式"


def check_point_binding(*, source: ColumnSource, node_key: str | None) -> None:
    """点位汇总列必须绑一个形状合法的 `node_key`。

    ⚠ 只验形状不验存在：点位可以晚于台账建，也可以先于台账删——列绑的是点位
    **身份**而不是外键，删点位不连坐台账历史（docs/DATASET_DESIGN.md §4.2）。
    Args: source, node_key。
    """
    if source != "point":
        return
    if not node_key:
        raise DatasetColumnInvalid(
            _MISSING_MESSAGE, details=(_detail("required", _MISSING_MESSAGE),)
        )
    try:
        split_node_key(node_key)
    except InvalidNodeKey as error:
        raise DatasetColumnInvalid(
            _SHAPE_MESSAGE, details=(_detail("invalid_format", _SHAPE_MESSAGE),)
        ) from error


def check_formula_present(*, source: ColumnSource, formula: str | None) -> None:
    """公式列必须带一条公式。

    ⚠ 不拦的话这一列永远算不出数，而它在配置界面上与一列真的空数据长得一模
    一样——没有任何一处会报错。
    Args: source, formula。
    """
    if source != "formula" or (formula and formula.strip()):
        return
    raise DatasetColumnInvalid(
        _NO_FORMULA_MESSAGE,
        details=(
            FieldError(
                field="formula",
                code="required",
                message=_NO_FORMULA_MESSAGE,
            ),
        ),
    )


def _detail(code: str, message: str) -> FieldError:
    """把一条列配置错误标到 `node_key` 输入框上。

    Args: code, message。
    """
    return FieldError(field="node_key", code=code, message=message)
