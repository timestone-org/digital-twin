"""层 4 记忆的三个扩展点：短期窗口、窗口外的折叠、长期知识。

三者默认各装一个 `Null*` 实现——**装不上就如实缺席**，与前端那套 ports
范式、以及模型没开时不造对象同一口径（ADR-0029 决策五）。

⚠ 这一层的每样东西都会进上下文，所以每样都要回答同一个问题：**它多久变一次。**
端点的前缀缓存认的是逐字相同的前缀（ADR-0025），一段每轮都变的东西插在历史区前面，
就是第五个断点——而断点没有任何运行期迹象，只有账单和延迟会慢慢变难看。
"""

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

from ai_assistant.apps.chat.models import ChatMessage

# 知识条目的归属面。⚠ `user` 是这个人自己的偏好，`project` 是项目的公共口径；
# 检索一律按调用者身份过滤，绝不能让 A 用户记的东西被 B 检索到
Scope = Literal["user", "project"]


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


@dataclass(frozen=True)
class Knowledge:
    """一条要记住的东西。"""

    scope: Scope
    owner_id: str
    title: str
    body: str


@dataclass(frozen=True)
class Hit:
    """一条召回。"""

    id: str
    title: str
    body: str
    score: float
    # ⚠ 没有向量的条目（嵌入当时失败）如实标出来，别让它看着像正常召回
    has_vector: bool


@runtime_checkable
class ShortTermStore(Protocol):
    """取最近的一截历史。"""

    def window(
        self, rows: list[ChatMessage], limit: int, step: int
    ) -> list[ChatMessage]:
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
        self, dropped: list[ChatMessage], through_seq: int
    ) -> Summary | None:
        """折一次；折不出来给 `None`。

        ⚠ 折不出来要给 `None` 而不是抛：折叠失败退回「直接丢」是可接受的降级，
        而让一个回合因为摘要没折成就发不出去不是。

        Args: dropped, through_seq（这一截的右边界，钉在台阶上）。
        """
        ...


@runtime_checkable
class LongTermStore(Protocol):
    """长期知识的读写面。"""

    async def remember(self, item: Knowledge) -> str:
        """记一条，回它的 id。

        ⚠ 嵌入算不出来时**仍然写入**（存文本、标记没有向量），由调用方如实
        告诉用户「这条暂时检索不到」。丢掉比记不全更坏。

        Args: item。
        """
        ...

    async def search(
        self, query: str, scope: Scope, owner_id: str, limit: int
    ) -> list[Hit]:
        """查最像的几条。

        ⚠ `scope` 与 `owner_id` 的过滤写在**这一层**，不写在调用点：
        写在调用点的话，下一个调用点漏掉它不会报错，只会多召回几条别人的。

        Args: query, scope, owner_id, limit。
        """
        ...
