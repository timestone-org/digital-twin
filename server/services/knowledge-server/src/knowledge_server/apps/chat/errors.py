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


class ChatScopeBaseUnknown(AppError):
    """范围里点名的知识库不存在。

    ⚠ 当场拒而不是把认不出的那几个悄悄丢掉：丢掉之后剩下的范围比用户划的宽
    （丢空了就成了「全部库」），而他从界面上看不出少了哪一个。
    """

    code = 42322
    http_status = 400


class ChatSessionVersionConflict(AppError):
    """这条会话在别处改过了，调用者手上那份是旧的。

    ⚠ 不做无条件覆盖：两个标签页开着同一条会话时，后写的那次会把先写的范围
    悄悄顶掉，而先写的那个人以为自己已经改好了。
    """

    code = 42323
    http_status = 409
