"""文档的出入参。"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from knowledge_server.apps.knowledge.errors import UnknownDocumentStatus
from knowledge_server.apps.knowledge.models.document import (
    STATUSES,
    TITLE_MAX_LENGTH,
)


class UploadTicketIn(BaseModel):
    """申请直传凭证的入参。"""

    filename: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    content_type: str = Field(default="", max_length=128)
    size_bytes: int = Field(gt=0)


class UploadTicketOut(BaseModel):
    """一张把键、类型与大小都钉死的直传表单。

    ⚠ `fields` 必须**原样按序**写进 multipart 表单，且文件字段排在最后：
    S3 的 POST 语义是「文件之后的字段一律忽略」，把 key 或签名排到文件后面，
    存储端读到的是一份缺字段的表单，报出来的是含糊的 403。
    """

    document_id: uuid.UUID
    url: str
    fields: dict[str, str]
    object_key: str
    expires_seconds: int


class RegisterDocumentIn(BaseModel):
    """确认直传完成、登记成一份文档。"""

    document_id: uuid.UUID
    filename: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)


class DocumentOut(BaseModel):
    """一份文档的样子。"""

    id: uuid.UUID
    base_id: uuid.UUID
    source_id: uuid.UUID
    title: str
    media_type: str
    byte_size: int
    # 摄取状态机走到哪了。闭合集合，与数据库 CHECK 同源
    status: str
    # 失败原因，一句人话。⚠ 不含表名、SQL、内网地址——它会原样上界面
    failure_reason: str
    chunk_count: int
    # 有没有可看可下的原件。⚠ 不让前端拿「有没有 media_type」去推：上传那一路
    # 登记时把 media_type 留成空串，推出来的结论会是「一份原件都没有」，
    # 而表现是预览入口整列不出现，且任何一处都不报错
    has_raw: bool
    created_at: datetime
    ready_at: datetime | None


def checked_status(given: str) -> str:
    """认不出的状态当场拒，不当成「不筛」。

    ⚠ 当成不筛的表现是「筛了跟没筛一样」，而用户会以为这个库里所有文档
    都是这个状态。

    ⚠ 抛的是领域异常而不是裸 `ValueError`：它是 query 参数，不经 pydantic 的
    请求体校验，裸 `ValueError` 会一路冒到未捕获处理器变成 500。

    Args: given（空串即不筛）。
    """
    if given and given not in STATUSES:
        raise UnknownDocumentStatus(f"没有叫 {given} 的文档状态")
    return given
