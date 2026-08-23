"""台账面那两跳跨进程依赖的假件：报脏口与归档库只读面。"""

from collections.abc import Mapping
from dataclasses import dataclass, field

# 减数查询的判别标志。⚠ 认这一段而不是整条 SQL：改了措辞用例仍该照常分流，
# 而两条查询答错对方那一份的表现是「delta 全空」或「所有桶都是同一个数」
PREVIOUS_END_MARKER = "DISTINCT ON"


@dataclass
class FakeSetSink:
    """进程内的集合登记，替掉 Redis。

    ⚠ 与真实现同样按集合去重：一次提交改十行只该留下一个成员，用例断言的正是
    这一点。
    """

    sets: dict[str, set[str]] = field(default_factory=dict[str, set[str]])

    async def add_to_set(self, key: str, *members: str) -> None:
        """把成员加进集合。

        Args: key, members。
        """
        self.sets.setdefault(key, set()).update(members)

    def members(self, key: str) -> set[str]:
        """看一眼某个集合里现在有什么。

        Args: key。
        """
        return set(self.sets.get(key, set()))


@dataclass
class FakeHistory:
    """归档库的只读面替身：分桶查询与减数查询各答一份预置结果。

    ⚠ 不解析 SQL：断言的是被测代码**生成**的文本与绑定参数，那才是会写错的
    地方。真跑一遍要 TimescaleDB，那一层由集成用例对着真库验。
    """

    buckets: list[dict[str, object]] = field(
        default_factory=list[dict[str, object]]
    )
    previous: list[dict[str, object]] = field(
        default_factory=list[dict[str, object]]
    )
    queries: list[tuple[str, dict[str, object]]] = field(
        default_factory=list[tuple[str, dict[str, object]]]
    )

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]:
        """按查询种类作答。

        Args: sql, params。
        """
        self.queries.append((sql, dict(params)))
        if PREVIOUS_END_MARKER in sql:
            return list(self.previous)
        return list(self.buckets)

    def sql_of(self, marker: str) -> str:
        """跑过的查询里第一条含这一段的 SQL。

        Args: marker。
        """
        return next(sql for sql, _ in self.queries if marker in sql)

    def params_of(self, marker: str) -> dict[str, object]:
        """跑过的查询里第一条含这一段的绑定参数。

        Args: marker。
        """
        return next(params for sql, params in self.queries if marker in sql)
