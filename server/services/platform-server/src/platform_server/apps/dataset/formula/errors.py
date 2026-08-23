"""公式域自己的两个异常。⚠ 都不是 `AppError`——它们的处置方式不同。

`FormulaError` 是**数据问题**：一条公式算不出来只该毁掉一个格子（写进
`compute_error`），别的列照常出数。归成 `AppError` 会一路冒到异常处理器，
把整行请求判失败。要变成 HTTP 错误的地方由 service 层显式转。
"""


class FormulaError(ValueError):
    """公式非法或求值失败。message 面向写公式的人，可直接展示。"""


class ExternalsNotPrefetched(RuntimeError):
    """externals 里缺了这条公式用得到的键——调用方漏装了一个取数相位。

    ⚠ 刻意**不是** `FormulaError`：公式本身合法，错的是调用方。归进
    `FormulaError` 就成了一个 compute_error 单元格，把编程错误伪装成数据
    问题；而「键在、值是空」是另一回事，那是合法的空值。
    """
