"""知识库域的异常（错误码领域号 23）。

每个异常自带错误码与 HTTP 状态，处理器不做 `isinstance` 长链分派。
message 面向最终用户，不含表名、SQL、内网地址等内部信息。

⚠ 404 同时覆盖「不存在」与「存在但调用者无权看见」：id 是可枚举的，
用 403 区分这两件事等于逐个 id 回答「这一条确实存在」。
"""

from lib.errors import AppError


class KnowledgeBaseNotFound(AppError):
    """知识库不存在，或存在但调用者无权看见。"""

    code = 42301
    http_status = 404


class UnsupportedRawItem(AppError):
    """没有哪一路解析器认得这份原件。

    ⚠ 这是一条**明确的错**，不是静默给空。静默给空的表现是「传上去了、
    状态是 ready、检索却永远查不到」——那与「这份文档里确实没这句话」
    长得一模一样。
    """

    code = 42302
    http_status = 415


class DocumentNotFound(AppError):
    """文档不存在，或存在但调用者无权看见。"""

    code = 42303
    http_status = 404


class SourceNotFound(AppError):
    """来源不存在，或存在但调用者无权看见。"""

    code = 42304
    http_status = 404


class UnknownRetrievalStrategy(AppError):
    """点名的检索策略这套部署没装。"""

    code = 42305
    http_status = 400


class RetrievalUnavailable(AppError):
    """这个库还检索不了：没配嵌入档，或它还没建过索引。

    ⚠ 如实报出来，不返回空表：空表与「确实没有相关内容」长得一模一样，
    而模型会把它读成「查过了，没有」然后接着往下走。
    """

    code = 42306
    http_status = 409
