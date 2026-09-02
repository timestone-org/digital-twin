"""对话域的异常。错误码沿用知识库的领域号 23，从 42320 起与库/文档那一段分开。

⚠ 404 同时覆盖「不存在」与「存在但调用者无权看见」：会话 id 是可枚举的，
用 403 区分这两件事等于逐个 id 回答「这条对话确实存在」。
"""

from lib.errors import AppError


class ChatSessionNotFound(AppError):
    """会话不存在，或存在但调用者无权看见。"""

    code = 42320
    http_status = 404


class ChatUnavailable(AppError):
    """这套部署没接对话档，对话面整个用不了。

    ⚠ 409 而不是 503：这不是「暂时不行」，是没配。前端按码分支，指路去配置。
    """

    code = 42321
    http_status = 409
