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


class FigureBytesGone(AppError):
    """图那一行还在，字节已经不在对象存储里了。

    ⚠ 与「没这一行」分开报：行还在而字节没了意味着桶被清过，而那是运维要知道
    的事，不是「用户点了个不存在的图」。混成 404 的话，前者永远查不出来。
    """

    code = 42310
    http_status = 410


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


class UnknownDocumentStatus(AppError):
    """点名的文档状态不在闭合集合里。

    ⚠ 当成「不筛」处理的表现是「筛了跟没筛一样」，而用户会以为这个库里
    所有文档都是这个状态。
    """

    code = 42307
    http_status = 400


class DuplicateDocument(AppError):
    """这份内容已经在这个库里了。

    ⚠ 判据是**内容哈希**不是文件名：文件名一改就当成新文档，是最常见的重复
    来源，而重复的表现是同一段话在检索里出现两次。

    ⚠ 如实回 409 而不是悄悄忽略：忽略的话用户以为传成功了，而界面上永远等不到
    那份新文档——它压根没有新的一行。
    """

    code = 42308
    http_status = 409


class StrategyCannotAnswer(AppError):
    """点名的策略只召回不作答。

    ⚠ 明说而不是回一个空答案：空答案看着像「模型没查到」，而其实是这一路
    压根不作答——用户会以为库里没有，然后不再找了。
    """

    code = 42309
    http_status = 409


class RawItemAbsent(AppError):
    """这份文档没有原件可看。

    ⚠ 与「文档不存在」分开报：外部系统那一路的一行是对方接口里的一条记录，
    它压根没有过原件（CONTEXT.md §1）。混成 404 的话，界面只能说「没有这份
    文档」——而它明明就在那张表里列着。
    """

    code = 42311
    http_status = 404


class RawBytesGone(AppError):
    """文档那一行还在，原件的字节已经不在对象存储里了。

    ⚠ 与「没有原件」分开报：这一档意味着桶被清过，是运维要知道的事，
    不是「这一路来源本来就没有文件」。
    """

    code = 42312
    http_status = 410
