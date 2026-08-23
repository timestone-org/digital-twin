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


class DatasetFormulaNotFound(AppError):
    """公式库里没有这条公式。"""

    code = 41220
    http_status = 404


class DatasetFormulaCodeTaken(AppError):
    """公式标识已被占用。标识是全局唯一的调用点字面量。"""

    code = 41221
    http_status = 409


class DatasetFormulaInUse(AppError):
    """还有台账列或别的库公式在用这条公式。

    ⚠ 停用与删除都会撞上它，理由相同：引用方在**解析期**就失败，而保存任一列
    都会试编译整张表，于是那张表的录入、导入、修正与重算一起 400。故这一条
    没有 `force` 出口——绕过去的代价是引用方在运行期静默崩掉
    （docs/DATASET_DESIGN.md §5.11）。
    """

    code = 41222
    http_status = 409


class DatasetFormulaPresetRule(AppError):
    """预设与自建的操作面不同。

    预设删不得（只能停用——删掉之后没有恢复入口），自建则没有出厂口径可恢复。
    """

    code = 41223
    http_status = 400


class DatasetBackfillInvalid(AppError):
    """回填区间不合法：区间为空，或整段没有可补的桶。

    ⚠ 与 `DatasetRecordInvalid` 分开：那一条说的是提交上来的**值**不合法，
    这一条说的是**时间范围**落在了取不到数的那一段——处置是改时间，不是改值。
    """

    code = 41230
    http_status = 400


class DatasetBackfillBusy(AppError):
    """这张台账已经有一个回填在跑。

    ⚠ 不是 400：请求本身合法，只是此刻排不上。调用方该做的是等它跑完或先取消，
    而不是改参数重试。
    """

    code = 41231
    http_status = 409


class DatasetBackfillNotRunning(AppError):
    """这张台账当前没有正在跑的回填，取消无从谈起。"""

    code = 41232
    http_status = 404


class DatasetBackfillUnreadable(AppError):
    """回填进度读不出来（存的内容已损坏）。

    ⚠ 与「没有任务」分成两件事：**「我说不出来」与「什么都没有」是两个答案**。
    合成一个的话，界面会在读不到的时候显示「没有回填任务」，而用户据此又发一次
    ——那一次撞上的是仍然握着锁的上一次。
    """

    # ⚠ 首位跟 HTTP 状态走：这一条是 503，故是 5 开头而不是 4
    code = 51230
    http_status = 503
