"""记录客户端实际执行回执：停止回合也能保存，无模型与工具副作用。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.schemas.receipts import ReceiptsIn, ReceiptsOut
from ai_assistant.apps.chat.services import client_receipts
from ai_assistant.apps.chat.services.client_result import ClientToolResult
from ai_assistant.apps.chat.services.session_service import require_session
from ai_assistant.deps import get_session, require
from ai_assistant.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, ok

SessionDep = Annotated[AsyncSession, Depends(get_session)]
UseDep = Annotated[CallerContext, Depends(require(ASSISTANT_USE))]

router = APIRouter(prefix=f"{API_PREFIX}/sessions", tags=["turn"])


@router.post(
    "/{session_id}:receipts",
    response_model=ApiResponse[ReceiptsOut],
    summary="记录客户端工具回执（不推进）",
)
async def save_receipts(
    session_id: uuid.UUID,
    payload: ReceiptsIn,
    session: SessionDep,
    caller: UseDep,
) -> ApiResponse[ReceiptsOut]:
    """只结算调用者已有调用。Args: session_id, payload, session, caller。"""
    await require_session(session, chat_session_id=session_id, caller=caller)
    accepted = await client_receipts.record(
        session,
        session_id,
        [
            ClientToolResult(
                call_id=row.call_id, output=row.output, error=row.error
            )
            for row in payload.tool_results
        ],
    )
    return ok(ReceiptsOut(accepted_call_ids=accepted))
