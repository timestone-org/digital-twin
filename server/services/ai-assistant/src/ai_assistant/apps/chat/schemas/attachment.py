"""上传一份参考文件（点表或纯文本资料）来解析。

⚠ 内容走 **base64 放在 JSON 里**，不用 multipart。两个理由：本仓一个 multipart
端点都没有（素材的字节是直传对象存储的，从不经过业务 API），引
`python-multipart` 就是为一个端点多一个依赖；而参考文件本身只有几百 KB，
base64 那 1/3 的膨胀无所谓。

⚠ 解析完就把内容交出去，**不落库、不进对象存储**：存文件要连带一整套生命周期
（谁能读、什么时候删、删了引用怎么办），而这份文件的用处只有一次——它是这一轮
对话的参考资料，不是资产。
"""

from pydantic import Field

from ai_assistant.apps.chat.schemas.common import InputModel, OutputModel

MAX_FILENAME = 255
# base64 之后的字符数上限，约合 2 MB 原文。⚠ 有上限：一份几十兆的文件读进来
# 会把进程的内存打满，而那时倒下的不只是这一个请求
MAX_CONTENT_CHARS = 2_800_000


class AttachmentParseIn(InputModel):
    """要解析的那个文件。"""

    filename: str = Field(min_length=1, max_length=MAX_FILENAME)
    # ⚠ 字段名带 `_base64` 后缀是刻意的：不带的话，调用方很容易直接塞原文进来，
    # 而那在服务端表现为「解码失败」，与「文件坏了」看着一模一样
    content_base64: str = Field(min_length=1, max_length=MAX_CONTENT_CHARS)


class AttachmentParseOut(OutputModel):
    """读出来的内容。表格有 columns/rows；纯文本两者为空，正文只在 text 里。"""

    columns: list[str]
    rows: list[list[str]]
    is_truncated: bool
    total_rows: int
    # 摊平给模型看的那一段。前端把它附在用户这句话后面——**用户看得见**
    # 助手将要看到什么，这一点比省几行界面重要
    text: str
