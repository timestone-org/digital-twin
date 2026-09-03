"""上传来源在对象存储里的键。

⚠ 键里编进**库 id、文档 id 与后缀**。前两者让「这份字节属于哪个库的哪份文档」
不必查库就说得清，而删库时按前缀一把清得干净；后缀则是解析器分派的**唯一
判据**——键里不带后缀的话，取回字节之后没有哪一路解析器认得出它是什么，
而那时报出来的是「这套部署不收这种格式」，与真实原因完全对不上号。

⚠ 上传落在 `staging/` 之下、验过再挪进正式前缀。没验过的字节不许有一个本站
链接——与素材那一套同源（ADR-0015）。

⚠ **原始文件名不进键**：它可以带路径分隔符、控制字符与任意长度，而对象键是
要拼进 URL 的。显示用的名字存在文档行上，键里只留一个净化过的后缀。
"""

import re
import uuid

# 知识库的对象前缀。⚠ 与素材那几个前缀分开：那几个是**匿名可读**的
# （模型、图片、图标），而知识库的原件一律不许匿名读
PREFIX = "knowledge"
STAGING = f"{PREFIX}/staging"

# 后缀里放行的字符。⚠ 白名单而不是黑名单：黑名单漏一个就够了
_SAFE_SUFFIX = re.compile(r"^\.[a-z0-9]{1,12}$")


def suffix_of(filename: str) -> str:
    """从文件名取一个能进键的后缀；取不出就给空串。

    Args: filename。
    """
    _head, dot, tail = filename.rpartition(".")
    if not dot:
        return ""
    candidate = f".{tail.lower()}"
    return candidate if _SAFE_SUFFIX.match(candidate) else ""


def staging_key(base_id: uuid.UUID, document_id: uuid.UUID, suffix: str) -> str:
    """未验证字节的落点。

    Args: base_id, document_id, suffix。
    """
    return f"{STAGING}/{base_id}/{document_id}{suffix}"


def document_key(
    base_id: uuid.UUID, document_id: uuid.UUID, suffix: str
) -> str:
    """验过之后的正式落点。

    Args: base_id, document_id, suffix。
    """
    return f"{PREFIX}/{base_id}/{document_id}{suffix}"


def document_prefix(base_id: uuid.UUID, document_id: uuid.UUID) -> str:
    """一份文档名下的派生物（图、表截图）。删文档时按它一把清。

    ⚠ 与原件那个键**不冲突**：原件是 `knowledge/{base}/{doc}.pdf`（一个对象），
    这里是 `knowledge/{base}/{doc}/`（一个前缀）。S3 的键是扁平字符串，
    两者可以并存。

    Args: base_id, document_id。
    """
    return f"{PREFIX}/{base_id}/{document_id}/"


def figure_key(
    base_id: uuid.UUID,
    document_id: uuid.UUID,
    content_hash: str,
    suffix: str,
) -> str:
    """一张图的落点。

    ⚠ 用**内容哈希**当名字而不是序号：重新解析时同一张图算出同一个键，
    于是不必重传、也不会在桶里留下一串孤儿。序号会随切分变化而漂。

    ⚠ 落在 `knowledge/` 前缀下 = **不匿名可读**。知识库里可能有涉密图纸，
    而素材那三个前缀（models/images/icons）是给现场大屏机匿名取的。

    Args: base_id, document_id, content_hash, suffix。
    """
    return (
        f"{document_prefix(base_id, document_id)}figures/{content_hash}{suffix}"
    )


def base_prefix(base_id: uuid.UUID) -> str:
    """一个库名下的全部原件。删库时按它一把清。

    Args: base_id。
    """
    return f"{PREFIX}/{base_id}/"
