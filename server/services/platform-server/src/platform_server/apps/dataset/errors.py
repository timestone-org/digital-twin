"""台账与公式域的异常（错误码领域号 12，见 docs/agents/api-contract.md §4.1）。

每个异常自带错误码与 HTTP 状态，处理器不做 `isinstance` 长链分派。
message 面向最终用户，不含表名、SQL、内网地址等内部信息。
"""

from lib.errors import AppError


class DatasetTableNotFound(AppError):
    """台账不存在，或存在但调用者无权看见。"""

    code = 41201
    http_status = 404


class DatasetColumnNotFound(AppError):
    """这张台账下没有这一列。"""

    code = 41202
    http_status = 404


class DatasetRecordNotFound(AppError):
    """这张台账下没有这一行。"""

    code = 41207
    http_status = 404


class DatasetTableCodeTaken(AppError):
    """台账编码已被占用。"""

    code = 41203
    http_status = 409


class DatasetColumnKeyTaken(AppError):
    """同一张台账下已有同名列 key。"""

    code = 41204
    http_status = 409


class DatasetTableNotEmpty(AppError):
    """台账下还有数据行。

    ⚠ 与「列还被引用」分开：这一条的处置是「确认要连历史一起删」，而那一条
    是「先改公式」。合成一个码会让调用方无从判断该给用户看哪句话。
    """

    code = 41205
    http_status = 409


class DatasetColumnInUse(AppError):
    """还有别的列的公式引用着这一列。"""

    code = 41206
    http_status = 409


class DatasetTableInvalid(AppError):
    """台账配置不合法：编码、周期或保留期写错了。"""

    code = 41210
    http_status = 400


class DatasetColumnInvalid(AppError):
    """列配置不合法：来源与它必需的那几项对不上。"""

    code = 41211
    http_status = 400


class DatasetFormulaInvalid(AppError):
    """公式写不通：语法、未知列、未知台账，或整表成环。

    ⚠ 与 `DatasetColumnInvalid` 分开：这一条的处置是「回编辑器改公式」，而
    那一条是「把来源那几项配齐」。合成一个码，界面就不知道该把光标放回哪里。
    ⚠ 校验端点**不用**它——那里 200 + `is_ok=false`（docs/DATASET_DESIGN.md
    §6.1）。它只在保存列时抛。
    """

    code = 41212
    http_status = 400


class DatasetRecordInvalid(AppError):
    """录入的值与列定义对不上：类型不符、必填缺失，或写到了写不得的列上。

    ⚠ 与 `DatasetColumnInvalid` 分开：那一条说的是**列的配置**写错了，
    要去改列；这一条说的是**这一次提交的值**不合法，要去改输入。
    """

    code = 41213
    http_status = 400
