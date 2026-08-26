"""解析上传的参考文件（点表或纯文本资料）。

⚠ 它**不存文件**：读完就把内容交出去，由前端附在用户那句话后面。存文件要连带
一整套生命周期，而这份文件的用处只有一次。
"""

import base64
import binascii
from typing import Annotated

from fastapi import APIRouter, Depends

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.schemas.attachment import (
    AttachmentParseIn,
    AttachmentParseOut,
)
from ai_assistant.apps.chat.services.tables import (
    ParsedTable,
    UnsupportedTable,
    parse_table,
    to_text,
)
from ai_assistant.deps import require
from ai_assistant.settings import API_PREFIX
from lib.auth import CallerContext
from lib.errors import ValidationFailed
from lib.web import ApiResponse, ok

router = APIRouter(prefix=f"{API_PREFIX}/attachments", tags=["attachment"])

UseDep = Annotated[CallerContext, Depends(require(ASSISTANT_USE))]


@router.post(
    ":parse",
    response_model=ApiResponse[AttachmentParseOut],
    summary="把上传的文件读成给模型看的文本",
)
async def parse_attachment(
    payload: AttachmentParseIn, _caller: UseDep
) -> ApiResponse[AttachmentParseOut]:
    """读一份 xlsx / csv / 纯文本：表格摊成表头加数据行，文本原样截取。

    Args: payload, _caller。
    """
    table = _parse(payload)
    return ok(
        AttachmentParseOut(
            columns=table.columns,
            rows=table.rows,
            is_truncated=table.is_truncated,
            total_rows=table.total_rows,
            text=to_text(table),
        )
    )


def _parse(payload: AttachmentParseIn) -> ParsedTable:
    """解码并解析；两类失败都指到具体是哪一步。

    ⚠ 解码失败与「这个格式不认得」要分开说：前者是调用方没按 base64 传，
    后者是文件本身不对，而两者的下一步动作完全不同。

    Args: payload。
    """
    try:
        content = base64.b64decode(payload.content_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValidationFailed("文件内容不是合法的 base64") from error
    try:
        return parse_table(payload.filename, content)
    except UnsupportedTable as error:
        raise ValidationFailed(str(error)) from error
