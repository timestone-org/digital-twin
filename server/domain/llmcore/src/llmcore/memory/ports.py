"""记忆这一层的两个扩展点：短期窗口与窗口外的折叠。

两者各有一个 `Null*` 实现——**装不上就如实缺席**，与前端那套 ports 范式、
以及模型没开时不造对象同一口径（ADR-0029 决策五）。

⚠ 这一层的每样东西都会进上下文，所以每样都要回答同一个问题：**它多久变一次。**
端点的前缀缓存认的是逐字相同的前缀（ADR-0025），一段每轮都变的东西插在历史区
前面，就是又一个断点——而断点没有任何运行期迹象，只有账单和延迟会慢慢变难看。
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable


@dataclass(frozen=True)
class HistoryRow:
    """一条历史消息，**只带这一层要用的三格**。

    ⚠ 收具体的 ORM 行不行：`domain` 不许含模型与 CRUD（ADR-0037 决策二），
    而各服务的会话表各在各的 schema 里。
    ⚠ 写成数据类而不是协议，是**实测**逼出来的：SQLAlchemy 那个声明列用的泛型
    在 pyright strict 下不满足「同名同类型属性」的协议（报的是
    `"role" is an incompatible type`），而各服务的 ORM 行正是那个形状。数据类把
    「从 ORM 出来」这一步显式化，边界也就看得见——各服务在读库处映一次，
    之后全是领域类型。
    ⚠ 只带真正读到的三格：多带一格就是多要求各服务填一格，而那一格这里不用。
    """

    role: str
    seq: int
    content_json: dict[str, Any]


@dataclass(frozen=True)
class Summary:
    """窗口外那一截折叠成的一段。

    ⚠ `through_seq` 是**锚**：摘要覆盖 `[0, through_seq)`，而这个边界钉在
    `HISTORY_DROP_STEP` 的台阶上。只有跨过下一个台阶才重算，其余轮次逐字复用——
    于是它与历史窗口同频，不引入新的前缀断点。
    """

    through_seq: int
    text: str
    # 哪一档模型折的。换了模型就该重折，否则两截摘要的口径对不上
    model: str


@runtime_checkable
class ShortTermStore(Protocol):
    """取最近的一截历史。"""

    def window(
        self, rows: Sequence[HistoryRow], limit: int, step: int
    ) -> list[HistoryRow]:
        """按台阶脱落取窗口。

        ⚠ 不是裸的 `[-limit:]`：那会让窗口每多一条消息就整体前移一格，
        历史区的前缀从此再也对不上。

        Args: rows, limit（高水位）, step（一次脱落几条）。
        """
        ...


@runtime_checkable
class Summarizer(Protocol):
    """把窗口外那一截折成一段。"""

    async def fold(
        self,
        dropped: Sequence[HistoryRow],
        through_seq: int,
        previous: Summary | None,
    ) -> Summary | None:
        """折一次；折不出来给 `None`。

        ⚠ 折不出来要给 `None` 而不是抛：折叠失败退回「直接丢」是可接受的降级，
        而让一个回合因为摘要没折成就发不出去不是。

        ⚠ **增量折**：`previous` 是上一个台阶折出来的那一段。不给它的话，
        每跨一个台阶就要把从头到现在的全部脱落消息再喂一遍——会话越长这一次
        调用越贵，最后贵过它省下来的那点上下文。给了它，喂进去的只有
        「上一段摘要 + 这一个台阶新脱落的那几条」，长度是有界的。

        Args: dropped（这一截全部脱落的消息，按 seq）, through_seq（右边界，
            钉在台阶上）, previous（上一个台阶的摘要，没有就是 None）。
        """
        ...
