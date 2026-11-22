"""解析上传的参考文件（点表或纯文本资料）。

⚠ 它**不存文件**：读完就把内容交出去，由前端附在用户那句话后面。存文件要连带
一整套生命周期，而这份文件的用处只有一次。

⚠ 挑哪一路解析走**解码器注册表**（`perception/registry`），不在这里判后缀：
加一种格式就该只是加一个解码器文件加注册表一行，而不是改这个函数体。

⚠ 它**不收图**。图是几兆字节，上去再原样下来纯属浪费——浏览器手里本来就有
那份字节。图随 `:advance` 的 `user_images` 走，白名单在那条路上判。
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.schemas.attachment import (
    AttachmentParseIn,
    AttachmentParseOut,
)
from ai_assistant.container import Container
from ai_assistant.deps import get_container, require
from ai_assistant.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, ok

router = APIRouter(prefix=f"{API_PREFIX}/attachments", tags=["attachment"])

UseDep = Annotated[CallerContext, Depends(require(ASSISTANT_USE))]
ContainerDep = Annotated[Container, Depends(get_container)]


@router.post(
    ":parse",
    response_model=ApiResponse[AttachmentParseOut],
    summary="把上传的文件读成给模型看的文本",
)
async def parse_attachment(
    payload: AttachmentParseIn, _caller: UseDep, container: ContainerDep
) -> ApiResponse[AttachmentParseOut]:
    """读一份 xlsx / csv / 纯文本：表格摊成竖线表，文本原样截取。

    Args: payload, _caller, container。
    """
    parsed = await container.attachments.parse(
        payload.filename, payload.content_base64
    )
    return ok(
        AttachmentParseOut(
            is_truncated=parsed.is_truncated,
            text=parsed.text,
            summary=parsed.summary,
        )
    )
