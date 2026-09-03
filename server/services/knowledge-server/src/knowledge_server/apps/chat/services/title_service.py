"""会话还没有标题时，用首轮问答给它起一个。

⚠ 起不出来也**绝不留空**：清单上一排「未命名」谁也分不清哪个是哪个。模型挂了
就退回用户那句话的开头，那比空白强得多。

⚠ 只在标题为空时起。用户手填过的绝不覆盖——他起的名字比模型起的准。

⚠ 起名这一步在回合**收摊之前**做，而不是丢给后台任务：`create_task` 要存强
引用、要处理进程关停时的丢失，而这件事本来就发生在流还开着的时候。代价是回合
末尾多约一秒。
"""

import uuid
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass

from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.models import ChatSession
from lib.logging import get_logger
from llmcore import ModelChoice
from llmcore.errors import ModelDisabled, ModelRejected, ModelUnavailable
from llmcore.turn import Responder

_logger = get_logger("knowledge.chat.title")

Sessions = Callable[[], AbstractAsyncContextManager[AsyncSession]]

#: 标题最多多少字。⚠ 与库上那一列（200）无关：这是给清单一行用的，
#: 长了会把时间戳挤掉
MAX_TITLE_CHARS = 16
# 交给模型的问答各截多长。⚠ 有上限：起个名字不值得把整轮对话再发一遍
MAX_QUESTION_CHARS = 200
MAX_ANSWER_CHARS = 400

# 标题两端要剥掉的记号。⚠ 引号与句号**一起剥、两端都剥**：分两步剥的话，
# 「冷却水参数」。 会先掉引号再掉句号，剩下一个孤零零的右引号
_TRIM = "“”「」《》【】\"' 。.！!？?：:、,，"

_PROMPT = (
    "给下面这轮对话起一个标题，用来在会话清单里认出它。"
    f"要求：不超过 {MAX_TITLE_CHARS} 个字、只回标题本身、"
    "不要引号、不要句号、不要「关于」这类废话开头。"
)


@dataclass(frozen=True)
class SessionTitled:
    """这个会话刚被自动命名。前端据它就地改清单那一行。"""

    title: str
    row_version: int


def fallback_title(question: str) -> str:
    """模型起不出来时，拿用户那句话的开头当标题。

    ⚠ 按**字符**截而不是按词：中文没有空格，按词截等于不截。

    Args: question。
    """
    return " ".join(question.split())[:MAX_TITLE_CHARS].strip()


def _cleaned(raw: str) -> str:
    """模型回的那一句收拾成能进清单的标题。

    ⚠ 引号与句号要剥：模型很爱加，而清单一行里它们只是噪声。

    Args: raw。
    """
    return " ".join(raw.split()).strip(_TRIM)[:MAX_TITLE_CHARS].strip(_TRIM)


async def _asked(model: Responder, question: str, answer: str) -> str:
    """问模型要一个标题；要不到给空串。

    ⚠ 起名失败只是 warning：它是锦上添花，不该让一个已经答完的回合报错。

    Args: model, question, answer。
    """
    body = (
        f"问：{question[:MAX_QUESTION_CHARS]}\n"
        f"答：{answer[:MAX_ANSWER_CHARS]}"
    )
    try:
        reply = await model.respond(
            choice=ModelChoice(kind="summary"),
            messages=[
                SystemMessage(content=_PROMPT),
                HumanMessage(content=body),
            ],
            tools=(),
        )
    except (ModelDisabled, ModelUnavailable, ModelRejected) as error:
        _logger.warning(
            "kb_chat_title_failed",
            "起标题没成，退回用户那句话的开头",
            reason=type(error).__name__,
        )
        return ""
    content = reply.content
    return _cleaned(content) if isinstance(content, str) else ""


async def _needs_title(sessions: Sessions, chat_session_id: uuid.UUID) -> bool:
    """这个会话还没有标题吗。

    ⚠ 单开一个事务先问一次：起名要调模型，而调模型是一次跨网络的外部 IO——
    包在事务里会让一次端点超时把数据库连接占住几十秒。

    Args: sessions, chat_session_id。
    """
    async with sessions() as session:
        row = await session.get(ChatSession, chat_session_id)
        return row is not None and not row.title


async def _stored(
    sessions: Sessions, chat_session_id: uuid.UUID, title: str
) -> SessionTitled | None:
    """把标题落库并推进行版本；期间被别人改过就让给他。

    ⚠ 再判一次「还没有标题」：问模型那几秒里用户可能自己改了名字，而覆盖
    他起的名字比不起名字更糟。

    Args: sessions, chat_session_id, title。
    """
    async with sessions() as session:
        row = await session.get(ChatSession, chat_session_id)
        if row is None or row.title:
            return None
        row.title = title
        row.row_version += 1
        await session.flush()
        made = SessionTitled(title=row.title, row_version=row.row_version)
    _logger.info(
        "kb_chat_session_titled",
        "对话已自动命名",
        session_id=str(chat_session_id),
    )
    return made


async def autotitle(
    sessions: Sessions,
    model: Responder,
    chat_session_id: uuid.UUID,
    exchange: tuple[str, str],
) -> SessionTitled | None:
    """会话还没有标题就起一个；已经有了或起不成就给 `None`。

    Args: sessions, model, chat_session_id, exchange（这一轮的问与答）。
    """
    question, answer = exchange
    if not question.strip() or not await _needs_title(
        sessions, chat_session_id
    ):
        return None
    title = await _asked(model, question, answer) or fallback_title(question)
    if not title:
        return None
    return await _stored(sessions, chat_session_id, title)
