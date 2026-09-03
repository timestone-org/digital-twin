"""会话自动命名的库那两步，打真库。

⚠ 这几条只能打真库：`autotitle` 跨两个事务（先问「还没有标题吗」、放掉事务去
调模型、再落库），而假件证明不了「问模型那几秒里用户改了名字会不会被覆盖」。
"""

import uuid
from collections.abc import Callable, Sequence
from typing import Any

import pytest
from langchain_core.messages import AIMessage, BaseMessage

from knowledge_server.apps.chat.models import ChatSession
from knowledge_server.apps.chat.services.title_service import autotitle
from llmcore import ModelChoice
from llmcore.errors import ModelUnavailable

pytestmark = pytest.mark.requires_postgres

OWNER = uuid.UUID("01a06000-0000-7000-8000-00000000f001")
EXCHANGE = ("冷凝器出口温度的上限是多少？另外压差怎么算", "不得高于 65 ℃。")


class _Model:
    """回一句固定标题的假模型。"""

    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.calls = 0

    async def respond(
        self,
        *,
        choice: ModelChoice,
        messages: list[BaseMessage],
        tools: Sequence[Any] = (),
        **rest: Any,
    ) -> BaseMessage:
        del choice, messages, tools, rest
        self.calls += 1
        return AIMessage(content=self.reply)


class _DeadModel:
    """此刻不可用的那一档。"""

    async def respond(self, **rest: Any) -> BaseMessage:
        del rest
        raise ModelUnavailable("这一路此刻不行")


async def _seeded(sessions: Callable[[], Any], title: str = "") -> uuid.UUID:
    async with sessions() as session:
        row = ChatSession(user_id=OWNER, title=title)
        session.add(row)
        await session.flush()
        return row.id


async def _title_of(sessions: Callable[[], Any], one: uuid.UUID) -> str:
    async with sessions() as session:
        row = await session.get(ChatSession, one)
        assert row is not None
        return row.title


async def test_an_untitled_session_gets_named_and_bumps_the_row_version(
    db_sessions: Callable[[], Any],
) -> None:
    """⚠ 行版本要跟着推：前端那把乐观锁靠它判手上那份旧没旧，不推的话
    用户接着改名会拿到一个「没冲突」的假象。"""
    one = await _seeded(db_sessions)
    made = await autotitle(
        db_sessions,
        _Model("「冷却水运行参数」。"),  # pyright: ignore[reportArgumentType]
        one,
        EXCHANGE,
    )
    assert made is not None
    assert made.title == "冷却水运行参数"
    assert made.row_version == 2
    assert await _title_of(db_sessions, one) == "冷却水运行参数"


async def test_a_session_the_user_already_named_is_left_alone(
    db_sessions: Callable[[], Any],
) -> None:
    """⚠ 他起的名字比模型起的准。覆盖它比不起名字更糟。"""
    model = _Model("模型起的名字")
    one = await _seeded(db_sessions, title="我自己起的")
    assert (
        await autotitle(
            db_sessions,
            model,  # pyright: ignore[reportArgumentType]
            one,
            EXCHANGE,
        )
        is None
    )
    assert await _title_of(db_sessions, one) == "我自己起的"
    # ⚠ 连模型都不该调到：起名字是要花钱的
    assert model.calls == 0


async def test_a_dead_model_falls_back_to_the_head_of_the_question(
    db_sessions: Callable[[], Any],
) -> None:
    """⚠ 起不出来也绝不留空：清单上一排「未命名」谁也分不清哪个是哪个。"""
    one = await _seeded(db_sessions)
    made = await autotitle(
        db_sessions,
        _DeadModel(),  # pyright: ignore[reportArgumentType]
        one,
        EXCHANGE,
    )
    assert made is not None
    assert made.title == "冷凝器出口温度的上限是多少？另外"


async def test_a_reply_of_only_punctuation_also_falls_back(
    db_sessions: Callable[[], Any],
) -> None:
    one = await _seeded(db_sessions)
    made = await autotitle(
        db_sessions,
        _Model("。。。"),  # pyright: ignore[reportArgumentType]
        one,
        EXCHANGE,
    )
    assert made is not None
    assert made.title.startswith("冷凝器出口温度")


async def test_an_empty_question_names_nothing(
    db_sessions: Callable[[], Any],
) -> None:
    """⚠ 没有问句就没有起名的依据，别拿答案单独起——那会起出一个与用户
    问的事对不上的名字。"""
    one = await _seeded(db_sessions)
    assert (
        await autotitle(
            db_sessions,
            _Model("随便"),  # pyright: ignore[reportArgumentType]
            one,
            ("   ", "答案"),
        )
        is None
    )
