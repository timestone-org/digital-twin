"""采集配置面的进程内假件：命令总线、计划广播、归档只读源。

三件都是纯进程内对象、零 IO，故住在 unit 层；整装应用的 fixture 与集成用例
同样用它们替掉那三跳跨进程调用。

⚠ 它们替的是**跨进程的那一跳**，不是被测逻辑：信封的构造、结论的翻译、SQL 的
文本与游标编码走的都还是真代码，用例因此仍然拦得住口径写错。
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from lib.errors import DependencyUnavailable

# 假件按动作预置应答，键就是命令总线上的动作名
ACTION_BROWSE = "browse"
ACTION_BROWSE_SUBTREE = "browse_subtree"
ACTION_READ = "read"
ACTION_WRITE = "write"
ACTION_VALIDATE = "validate"


@dataclass
class FakeCommandTransport:
    """替掉 Redis 的命令总线：按动作名回预置应答。

    `replies` 里没有的动作视为**没等到应答**（回 None），那正是超时那一档。
    """

    replies: dict[str, dict[str, Any]] = field(
        default_factory=dict[str, dict[str, Any]]
    )
    sent: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    # 每次调用给的预算。⚠ 记下来才验得了「浏览与别的命令不共用一档超时」
    budgets: list[float] = field(default_factory=list[float])
    failure: Exception | None = None

    async def call(
        self,
        envelope: Mapping[str, Any],
        *,
        request_id: str,
        timeout_s: float,
    ) -> dict[str, Any] | None:
        self.budgets.append(timeout_s)
        # 信封必须是可 JSON 序列化的：真传输面会 json.dumps 它
        self.sent.append(json.loads(json.dumps(dict(envelope), default=str)))
        if self.failure is not None:
            raise self.failure
        prepared = self.replies.get(str(envelope.get("action")))
        if prepared is None:
            return None
        return {"request_id": request_id, **prepared}

    async def close(self) -> None:
        self.replies.clear()

    def envelopes_of(self, action: str) -> list[dict[str, Any]]:
        """按动作取发出去的信封。

        Args: action。
        """
        return [item for item in self.sent if item.get("action") == action]


def unreachable_transport() -> FakeCommandTransport:
    """一个把每次调用都判成依赖不可用的传输面。"""
    return FakeCommandTransport(
        failure=DependencyUnavailable("命令总线暂时不可用")
    )


@dataclass
class FakeChannelPublisher:
    """替掉 Redis pub/sub：把广播记下来。"""

    published: list[tuple[str, dict[str, object]]] = field(
        default_factory=list[tuple[str, dict[str, object]]]
    )
    failure: Exception | None = None

    async def publish(self, channel: str, payload: dict[str, object]) -> int:
        if self.failure is not None:
            raise self.failure
        self.published.append((channel, payload))
        return 1


@dataclass
class FakeHistorySource:
    """替掉归档库：按预置的行作答，并留下跑过的 SQL 与参数。

    ⚠ 不解析 SQL：断言的是被测代码**生成**的文本与绑定参数，那才是会写错的
    地方。真跑一遍需要 TimescaleDB，而 `time_bucket` 在普通 Postgres 上不存在。
    """

    rows: list[dict[str, object]] = field(
        default_factory=list[dict[str, object]]
    )
    queries: list[tuple[str, dict[str, object]]] = field(
        default_factory=list[tuple[str, dict[str, object]]]
    )
    failure: Exception | None = None

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]:
        self.queries.append((sql, dict(params)))
        if self.failure is not None:
            raise self.failure
        row_limit = params.get("row_limit")
        limit = row_limit if isinstance(row_limit, int) else len(self.rows)
        return list(self.rows)[:limit]

    @property
    def last_sql(self) -> str:
        """最后一次跑的 SQL 文本。"""
        return self.queries[-1][0]

    @property
    def last_params(self) -> dict[str, object]:
        """最后一次跑的绑定参数。"""
        return self.queries[-1][1]
