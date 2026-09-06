"""Word 原件直传与导入提交，不让文件字节穿过 API。"""

import re
import uuid

from lib.objectstore import ObjectStore, UploadLimits
from platform_server.apps.report.errors import ReportInvalid
from platform_server.apps.report.schemas.jobs import (
    ImportTicketIn,
    ImportTicketOut,
)
from platform_server.apps.report.services.docx_import import MAX_IMPORT_BYTES
from platform_server.apps.report.services.render_service import CONTENT_TYPE


async def upload_ticket(
    store: ObjectStore, actor: str, payload: ImportTicketIn
) -> ImportTicketOut:
    """签发调用者范围的 Word 上传凭证。Args: store, actor, payload。"""
    key = f"reports/imports/{actor}/{uuid.uuid4()}.docx"
    ticket = await store.presign_post(
        key,
        content_type=CONTENT_TYPE,
        limits=UploadLimits(min_bytes=1, max_bytes=payload.size_bytes),
        ttl_s=300,
    )
    return ImportTicketOut(url=ticket.url, fields=ticket.fields, object_key=key)


async def validate_source(store: ObjectStore, actor: str, key: str) -> None:
    """只允许使用本人前缀内的有界原件。Args: store, actor, key。"""
    if not re.fullmatch(
        rf"reports/imports/{re.escape(actor)}/[0-9a-f-]{{36}}\.docx", key
    ):
        raise ReportInvalid("导入原件身份无效")
    stat = await store.stat(key)
    if stat is None or not 0 < stat.size_bytes <= MAX_IMPORT_BYTES:
        raise ReportInvalid("原件不存在或文件大小超过限制")
