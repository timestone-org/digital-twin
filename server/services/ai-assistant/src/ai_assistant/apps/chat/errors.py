"""会话域的异常（错误码领域号 22）。

每个异常自带错误码与 HTTP 状态，处理器不做 `isinstance` 长链分派。
message 面向最终用户，不含表名、SQL、内网地址等内部信息。

⚠ 404 同时覆盖「不存在」与「存在但调用者无权看见」：会话 id 是可枚举的，
用 403 区分这两件事等于逐个 id 回答「这条对话确实存在」。
"""

from lib.errors import AppError


class SessionNotFound(AppError):
    """会话不存在，或存在但调用者无权看见。"""

    code = 42201
    http_status = 404
