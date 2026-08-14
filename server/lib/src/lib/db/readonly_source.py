"""外部只读 SQL 源的访问件：只跑 SELECT，不建表、不写入、不进迁移链。

驱动是同步的，故每个公开方法都把阻塞工作交给线程；驱动异常一律收敛成
`DependencyUnavailable`，上层不必认识第三方库的异常类型。
"""

import asyncio
import math
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from lib.errors.base import DependencyUnavailable
from lib.logging.logger import get_logger

_logger = get_logger("lib.db.readonly")

_DEPENDENCY = "sql-source"
# 裸标识符白名单：字母、数字、下划线，最长 128
_IDENTIFIER = re.compile(r"[A-Za-z0-9_]{1,128}")
_COLUMNS_SQL = (
    "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE"
    " FROM INFORMATION_SCHEMA.COLUMNS"
    " WHERE TABLE_NAME IN ({placeholders})"
)


def quote_identifier(name: str) -> str:
    """校验一个裸标识符并包成方括号形式；不合法即抛 ValueError。

    ⚠ 用 fullmatch 不用 match：`$` 在 Python 里也匹配结尾换行，`"A\\n"`
    会从 match 底下漏过去，然后原样拼进 SQL。
    Args: name。
    """
    if _IDENTIFIER.fullmatch(name) is None:
        raise ValueError(f"标识符不合法：{name!r}")
    return f"[{name}]"


@dataclass(frozen=True)
class SourceProfile:
    """只读源的连接池容量与各级超时。"""

    pool_size: int = 5
    pool_recycle_s: int = 3600
    login_timeout_s: float = 5.0
    query_timeout_s: float = 15.0
    # ⚠ 客户端字符集。源库里 varchar 列按它自己的排序规则存字节，驱动要照这个
    # 字符集转码。配错不会报错，只会把非 ASCII 文本变成一串看不懂的字母——而且
    # 同一份代码在不同宿主上表现可能不同，开发机上正常、容器里乱码是常态
    charset: str = "UTF-8"

    @property
    def call_budget_s(self) -> float:
        """一次调用的总预算：登录 + 查询，供外层取消兜底。"""
        return self.login_timeout_s + self.query_timeout_s


DEFAULT_SOURCE = SourceProfile()


class EngineFactory(Protocol):
    """建同步引擎的工厂。默认是 sqlalchemy 的 create_engine。"""

    def __call__(self, url: str, **options: object) -> Engine: ...


class ReadOnlySqlSource:
    """一个外部只读 SQL 源的句柄。进程内单例，只是无状态的连接池句柄。"""

    def __init__(
        self,
        *,
        dsn: str,
        profile: SourceProfile = DEFAULT_SOURCE,
        factory: EngineFactory = create_engine,
    ) -> None:
        self._profile = profile
        self._engine = factory(
            dsn,
            pool_size=profile.pool_size,
            pool_recycle=profile.pool_recycle_s,
            pool_pre_ping=True,
            # ⚠ 驱动只收整秒，向上取整免得亚秒预算被截成「不限时」
            connect_args={
                "login_timeout": math.ceil(profile.login_timeout_s),
                "timeout": math.ceil(profile.query_timeout_s),
                "charset": profile.charset,
            },
        )

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]:
        """跑一条只读查询，把结果行按列名映射成字典。

        Args: sql, params（值一律绑定参数，标识符走 quote_identifier）。
        """
        bound = dict(params)
        return await self._run(lambda: self._read(sql, bound))

    async def describe_columns(
        self, object_names: Sequence[str]
    ) -> dict[str, dict[str, str]]:
        """读信息模式，给出每个对象的「列名 → 数据类型」。

        Args: object_names（在这条查询里是值不是标识符，故走绑定参数）。
        """
        if not object_names:
            return {}
        params: dict[str, object] = {
            f"name_{position}": name
            for position, name in enumerate(object_names)
        }
        placeholders = ", ".join(f":{key}" for key in params)
        rows = await self.fetch_all(
            _COLUMNS_SQL.format(placeholders=placeholders), params
        )
        return _group_by_object(rows)

    async def ping(self) -> bool:
        """连通性自检。不抛，供启动自检复用。"""
        try:
            await self.fetch_all("SELECT 1 AS probe", {})
        except Exception as error:
            _logger.warning(
                "sql_source_ping_failed", "只读数据源不可达", error=error
            )
            return False
        return True

    async def dispose(self) -> None:
        """关闭连接池。关停序列的最后一步。"""
        await asyncio.to_thread(self._engine.dispose)

    def _read(
        self, sql: str, params: dict[str, object]
    ) -> list[dict[str, object]]:
        with self._engine.connect() as connection:
            rows = connection.execute(text(sql), params).mappings().all()
        return [dict(row) for row in rows]

    async def _run[ResultT](self, work: Callable[[], ResultT]) -> ResultT:
        """把阻塞工作放进线程并给它一个总预算，失败一律包成依赖不可用。

        ⚠ 外层取消只解开等待，同步驱动的那个线程还在跑——预算因此取
        「登录 + 查询」之和，让驱动自己的超时先到期。
        Args: work。
        """
        try:
            async with asyncio.timeout(self._profile.call_budget_s):
                return await asyncio.to_thread(work)
        except (SQLAlchemyError, TimeoutError) as error:
            raise DependencyUnavailable(
                "只读数据源暂时不可用",
                context={"dependency": _DEPENDENCY},
            ) from error


def _group_by_object(
    rows: Sequence[Mapping[str, object]],
) -> dict[str, dict[str, str]]:
    found: dict[str, dict[str, str]] = {}
    for row in rows:
        columns = found.setdefault(str(row["TABLE_NAME"]), {})
        columns[str(row["COLUMN_NAME"])] = str(row["DATA_TYPE"])
    return found
