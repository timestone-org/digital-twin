"""锁住只读 SQL 源的契约：装配参数、异常收敛、超时兜底、标识符白名单。

⚠ 这一层用 sqlite 跑（testing-standard-python.md §6.3 允许 L1 这么做），
且**不打任何网络**：验的是本层自己的收敛与映射，方言差异归部署自检。
"""

import time
from collections.abc import AsyncIterator, Sequence

import pytest
from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.pool import StaticPool

from lib.db import ReadOnlySqlSource, SourceProfile, quote_identifier
from lib.errors.base import DependencyUnavailable

DSN = "mssql+pymssql://svc:p%40ss@host.internal:1433/main"
MAX_IDENTIFIER = 128
STALL_S = 0.5


def _sqlite_engine(url: str) -> Engine:
    """一个进程内的假源。

    ⚠ 必须同时给 StaticPool 与 check_same_thread=False：被测件把查询放进
    线程跑，而 sqlite 的连接默认只认创建它的那个线程。
    Args: url。
    """
    return create_engine(
        url,
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )


class SqliteFactory:
    """把只读源接到进程内 sqlite，同时记下它收到的装配参数。

    Args: url（引擎真正指向的地方）, connect_delay_s（模拟卡住的驱动）。
    """

    def __init__(
        self, *, url: str = "sqlite://", connect_delay_s: float = 0.0
    ) -> None:
        self.url = url
        self.connect_delay_s = connect_delay_s
        self.received: dict[str, object] = {}
        self.engine: Engine = _sqlite_engine("sqlite://")

    def __call__(self, url: str, **options: object) -> Engine:
        self.received = {"url": url, **options}
        self.engine = _sqlite_engine(self.url)
        if self.connect_delay_s > 0:
            event.listen(self.engine, "connect", self._stall)
        return self.engine

    def _stall(self, *_args: object) -> None:
        # ⚠ 这里的 sleep 就是被测对象本身（一个不返回的驱动），不是在等异步完成
        time.sleep(self.connect_delay_s)


def seed(engine: Engine, statements: Sequence[str]) -> None:
    """在假源里建好被查的对象。

    Args: engine, statements。
    """
    with engine.connect() as connection:
        for statement in statements:
            connection.execute(text(statement))
        connection.commit()


@pytest.fixture
def factory() -> SqliteFactory:
    return SqliteFactory()


@pytest.fixture
async def source(factory: SqliteFactory) -> AsyncIterator[ReadOnlySqlSource]:
    handle = ReadOnlySqlSource(dsn=DSN, factory=factory)
    yield handle
    await handle.dispose()


def test_engine_is_assembled_with_the_configured_pool_and_timeouts() -> None:
    recorder = SqliteFactory()
    ReadOnlySqlSource(
        dsn=DSN,
        profile=SourceProfile(
            pool_size=3,
            pool_recycle_s=60,
            login_timeout_s=2.0,
            query_timeout_s=7.0,
        ),
        factory=recorder,
    )
    assert recorder.received == {
        "url": DSN,
        "pool_size": 3,
        "pool_recycle": 60,
        "pool_pre_ping": True,
        "connect_args": {"login_timeout": 2, "timeout": 7},
    }


def test_sub_second_timeouts_round_up_to_a_whole_second() -> None:
    # ⚠ 向下取整会得到 0，而 0 在驱动那边的含义是「不限时」
    recorder = SqliteFactory()
    ReadOnlySqlSource(
        dsn=DSN,
        profile=SourceProfile(login_timeout_s=0.2, query_timeout_s=0.3),
        factory=recorder,
    )
    assert recorder.received["connect_args"] == {
        "login_timeout": 1,
        "timeout": 1,
    }


def test_call_budget_covers_login_plus_query() -> None:
    profile = SourceProfile(login_timeout_s=5.0, query_timeout_s=15.0)
    assert profile.call_budget_s == 20.0


async def test_fetch_all_maps_rows_by_column_name(
    factory: SqliteFactory, source: ReadOnlySqlSource
) -> None:
    seed(
        factory.engine,
        [
            "CREATE TABLE samples (label text, reading real)",
            "INSERT INTO samples VALUES ('a', 1.5), ('b', 2.5)",
        ],
    )
    rows = await source.fetch_all(
        "SELECT label, reading FROM samples ORDER BY label", {}
    )
    assert rows == [
        {"label": "a", "reading": 1.5},
        {"label": "b", "reading": 2.5},
    ]


async def test_fetch_all_keeps_nulls_instead_of_folding_them_to_zero(
    factory: SqliteFactory, source: ReadOnlySqlSource
) -> None:
    # ⚠ 把 NULL 折成 0 会把一段数据断档读成一次真实的零值
    seed(
        factory.engine,
        [
            "CREATE TABLE samples (label text, reading real)",
            "INSERT INTO samples VALUES ('a', NULL)",
        ],
    )
    assert await source.fetch_all("SELECT reading FROM samples", {}) == [
        {"reading": None}
    ]


async def test_fetch_all_binds_values_instead_of_interpolating_them(
    source: ReadOnlySqlSource,
) -> None:
    rows = await source.fetch_all(
        "SELECT :probe AS echoed", {"probe": "a' OR 1=1 --"}
    )
    assert rows == [{"echoed": "a' OR 1=1 --"}]


async def test_fetch_all_returns_an_empty_list_when_nothing_matches(
    factory: SqliteFactory, source: ReadOnlySqlSource
) -> None:
    seed(factory.engine, ["CREATE TABLE samples (label text)"])
    assert await source.fetch_all("SELECT label FROM samples", {}) == []


async def test_driver_errors_are_wrapped_as_dependency_unavailable(
    source: ReadOnlySqlSource,
) -> None:
    # ⚠ 基础设施异常不许裸露给上层：业务层不该认识 SQLAlchemyError
    with pytest.raises(DependencyUnavailable) as caught:
        await source.fetch_all("SELECT * FROM absent", {})
    assert caught.value.context == {"dependency": "sql-source"}
    assert caught.value.http_status == 503
    assert caught.value.is_retryable is True


async def test_a_call_that_outlives_its_budget_is_dependency_unavailable() -> (
    None
):
    stalled = SqliteFactory(connect_delay_s=STALL_S)
    handle = ReadOnlySqlSource(
        dsn=DSN,
        profile=SourceProfile(login_timeout_s=0.01, query_timeout_s=0.01),
        factory=stalled,
    )
    with pytest.raises(DependencyUnavailable):
        await handle.fetch_all("SELECT 1 AS probe", {})


async def test_ping_is_true_when_the_source_answers(
    source: ReadOnlySqlSource,
) -> None:
    assert await source.ping() is True


async def test_ping_returns_false_instead_of_raising() -> None:
    # ⚠ 探针不许抛：启动自检要的是一个布尔，不是异常
    unreachable = SqliteFactory(url="sqlite:////nonexistent/dir/probe.db")
    handle = ReadOnlySqlSource(dsn=DSN, factory=unreachable)
    assert await handle.ping() is False
    await handle.dispose()


async def test_describe_columns_groups_data_types_by_object(
    factory: SqliteFactory, source: ReadOnlySqlSource
) -> None:
    seed(
        factory.engine,
        [
            "ATTACH DATABASE ':memory:' AS INFORMATION_SCHEMA",
            "CREATE TABLE INFORMATION_SCHEMA.COLUMNS"
            " (TABLE_NAME text, COLUMN_NAME text, DATA_TYPE text)",
            "INSERT INTO INFORMATION_SCHEMA.COLUMNS VALUES"
            " ('one', 'stamp', 'datetime'), ('one', 'reading', 'float'),"
            " ('two', 'stamp', 'datetime'), ('three', 'label', 'nvarchar')",
        ],
    )
    assert await source.describe_columns(["one", "two"]) == {
        "one": {"stamp": "datetime", "reading": "float"},
        "two": {"stamp": "datetime"},
    }


async def test_describe_columns_asks_nothing_when_given_no_names(
    source: ReadOnlySqlSource,
) -> None:
    # 空名单还去查会拼出 `IN ()`，那是一条语法错误，不是一个空结果
    assert await source.describe_columns([]) == {}


async def test_dispose_closes_the_pool(
    factory: SqliteFactory, source: ReadOnlySqlSource
) -> None:
    closed: list[str] = []
    event.listen(
        factory.engine, "engine_disposed", lambda _engine: closed.append("once")
    )
    await source.dispose()
    assert closed == ["once"]


def test_quote_identifier_wraps_a_bare_name_in_brackets() -> None:
    assert quote_identifier("Data_01") == "[Data_01]"


def test_quote_identifier_accepts_the_longest_allowed_name() -> None:
    name = "a" * MAX_IDENTIFIER
    assert quote_identifier(name) == f"[{name}]"


@pytest.mark.parametrize(
    "name",
    ["a-b", "a b", "a;drop", "K01\n", "", "a" * (MAX_IDENTIFIER + 1)],
    ids=["hyphen", "space", "statement", "newline", "empty", "too-long"],
)
def test_quote_identifier_rejects_anything_outside_the_whitelist(
    name: str,
) -> None:
    # ⚠ newline 这档是 fullmatch 与 match 的分水岭：`$` 也匹配结尾换行
    with pytest.raises(ValueError, match="标识符不合法"):
        quote_identifier(name)
