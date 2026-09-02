"""长期记忆的扩展点（ADR-0030）：跨会话记得住的那一层。

短期窗口与窗口外折叠在 `llmcore.memory.ports`——那两样两个服务共用。

⚠ **长期知识没有 `Null` 实现，也不该有。** 这一层真正可缺席的是**嵌入档**
（没配就只能存不能排），而库总是在的——造一个 `NullLongTermStore` 会是一段
没人构造的死代码。仓储没接上时由 `MemoryTools` 抛一句点得出名字的错。
"""

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

# 知识条目的归属面。⚠ `user` 是这个人自己的偏好，`project` 是项目的公共口径；
# 检索一律按调用者身份过滤，绝不能让 A 用户记的东西被 B 检索到
Scope = Literal["user", "project"]


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
class LongTermStore(Protocol):
    """长期知识的读写面。"""

    @property
    def can_rank(self) -> bool:
        """检索排得了序吗。

        ⚠ 调用方要据它如实告诉用户：没接嵌入档时检索恒为空，而「查不到」与
        「没记过」是两件事——不说清的话，模型会当成用户从没交代过。
        """
        ...

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
