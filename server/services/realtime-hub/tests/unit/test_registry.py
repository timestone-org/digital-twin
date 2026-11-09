"""主题登记的并发口径：同码重复登记幂等，且不靠「先查再插」。

⚠ 两个推送方并发登记时唯一约束只在提交那一刻炸，真库上才复现得稳；这里用
假件把「查的时候还没有、写的时候已经有了」钉成确定的时序。
"""

from types import TracebackType
from typing import Any, Self, cast

import pytest
from realtime_hub.apps.channel.crud import TopicCrud
from realtime_hub.apps.channel.errors import TopicAlreadyDeclared
from realtime_hub.apps.channel.models import TopicDeclaration
from realtime_hub.apps.channel.services import TopicRegistry
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError

from lib.db import Database

TOPIC = "opcua:1"
CODE = "opcua:view"
OTHER_CODE = "opcua:manage"


class _Catalog:
    async def known_codes(self) -> frozenset[str]:
        return frozenset({CODE, OTHER_CODE})


class _RacedDatabase:
    """别的副本抢先提交了同名主题：提交撞唯一约束。"""

    def __init__(self) -> None:
        self.has_pending_insert = False

    def session(self) -> Self:
        return self

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        _exc: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        if exc_type is None and self.has_pending_insert:
            raise IntegrityError("INSERT", {}, Exception("duplicate key"))


class _RacedTopics:
    """胜出方的行只在抢写之后才看得见的主题表。"""

    def __init__(self, database: _RacedDatabase, *, winner_code: str) -> None:
        self._database = database
        self._winner = TopicDeclaration(
            topic=TOPIC, required_code=winner_code, publisher="other-replica"
        )
        self._is_winner_visible = False

    async def get_by_topic(
        self, _session: object, _topic: str
    ) -> TopicDeclaration | None:
        return self._winner if self._is_winner_visible else None

    def add(self, _session: object, _row: TopicDeclaration) -> None:
        self._database.has_pending_insert = True

    async def insert_if_absent(
        self, _session: object, **_fields: object
    ) -> bool:
        self._is_winner_visible = True
        return False


def _registry(*, winner_code: str) -> TopicRegistry:
    database = _RacedDatabase()
    return TopicRegistry(
        database=cast("Database", database),
        catalog=cast("Any", _Catalog()),
        topics=cast(
            "TopicCrud", _RacedTopics(database, winner_code=winner_code)
        ),
    )


async def _declare(registry: TopicRegistry, *, code: str) -> None:
    await registry.declare(topic=TOPIC, required_code=code, publisher="opcua")


async def test_losing_a_declare_race_with_the_same_code_succeeds() -> None:
    assert await _declare(_registry(winner_code=CODE), code=CODE) is None


async def test_losing_a_declare_race_with_another_code_conflicts() -> None:
    with pytest.raises(TopicAlreadyDeclared):
        await _declare(_registry(winner_code=OTHER_CODE), code=CODE)


class _RecordingSession:
    def __init__(self, *, inserted: object) -> None:
        self.statements: list[Any] = []
        self._inserted = inserted

    async def execute(self, statement: object) -> "_RecordingSession":
        self.statements.append(statement)
        return self

    def scalar_one_or_none(self) -> object:
        return self._inserted


async def _insert(session: _RecordingSession) -> bool:
    return await TopicCrud().insert_if_absent(
        cast("Any", session),
        topic=TOPIC,
        required_code=CODE,
        publisher="opcua",
    )


async def test_the_insert_yields_to_the_unique_constraint() -> None:
    session = _RecordingSession(inserted=None)
    assert await _insert(session) is False
    compiled = str(session.statements[0].compile(dialect=postgresql.dialect()))
    assert "ON CONFLICT (topic) DO NOTHING" in compiled


async def test_a_returned_row_means_the_insert_happened() -> None:
    assert await _insert(_RecordingSession(inserted="row-id")) is True


class _CountingTopics:
    """按主题回声明码的假表，记下被问了几次。"""

    def __init__(self, declared: dict[str, str]) -> None:
        self._declared = declared
        self.calls = 0

    async def required_codes_of(
        self, _session: object, topics: frozenset[str]
    ) -> dict[str, str]:
        self.calls += 1
        return {
            topic: code
            for topic, code in self._declared.items()
            if topic in topics
        }


async def test_denied_topics_asks_the_table_once_for_all_topics() -> None:
    # ⚠ 换票时按主题逐个开事务，一面墙同时换票就是 K×连接数次单行查询
    topics = _CountingTopics({"a:1": CODE, "a:2": OTHER_CODE})
    registry = TopicRegistry(
        database=cast("Database", _RacedDatabase()),
        catalog=cast("Any", _Catalog()),
        topics=cast("TopicCrud", topics),
    )

    denied = await registry.denied_topics(
        topics=frozenset({"a:1", "a:2", "gone:3"}), codes=frozenset({CODE})
    )

    assert (denied, topics.calls) == (frozenset({"a:2", "gone:3"}), 1)


async def test_required_codes_of_is_one_in_query() -> None:
    session = _RecordingSession(inserted=None)
    session.tuples = lambda: session  # type: ignore[attr-defined]  # 测试注入
    session.all = lambda: [("a:1", CODE)]  # type: ignore[attr-defined]  # 同上

    codes = await TopicCrud().required_codes_of(
        cast("Any", session), frozenset({"a:1", "a:2"})
    )

    compiled = str(session.statements[0].compile(dialect=postgresql.dialect()))
    assert (codes, len(session.statements), " IN " in compiled) == (
        {"a:1": CODE},
        1,
        True,
    )
