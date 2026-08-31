"""层 2 意图理解的扩展点：这一轮模型看得见什么。

⚠ **这一层不做独立的意图识别调用。** 意图由主模型在同一次调用里定；多插一次
分类调用会打断端点的前缀缓存，而那正是 ADR-0025 花一整轮修的东西（静态区
11 812 字符，断点曾落在第 789）。

这一层做的是**机械收窄**——不会猜错的那种。一道 Gate 只回答「这一轮不许看见
什么」，多道按注册序依次收窄，谁都不许放宽。

⚠ 收窄只是**省一次往返**，不是权限边界。工具最终调 platform，由那边按端点判权限
（CONTEXT.md §2）。把这里当成安全闸的话，下一个人会以为不用在 platform 上判了。
"""

from dataclasses import dataclass, replace
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class TurnContext:
    """一道 Gate 判断时能看到的东西。"""

    surface_kind: str
    # 前端自报实现了哪些客户端工具；`None` = 老前端没报这一格
    client_tools: tuple[str, ...] | None
    # 调用者此刻持有的权限码
    codes: frozenset[str]


@dataclass(frozen=True)
class Allowed:
    """这一轮准许出现的工具与技能。"""

    tools: frozenset[str]
    skills: frozenset[str]

    def keep_tools(self, names: frozenset[str]) -> "Allowed":
        """只留这些工具。

        Args: names。
        """
        return replace(self, tools=self.tools & names)

    def keep_skills(self, names: frozenset[str]) -> "Allowed":
        """只留这些技能。

        Args: names。
        """
        return replace(self, skills=self.skills & names)


@runtime_checkable
class Gate(Protocol):
    """一道收窄。

    ⚠ **只许收窄，不许放宽。** 放宽的那一道会把前面几道的判断一笔勾销，而顺序
    一换结果就变——那时「为什么这个工具有时在有时不在」没人答得上来。这条由一条
    契约测试守：对任意输入，`narrow` 的产出必须是入参的子集。
    """

    @property
    def name(self) -> str:
        """这一道收窄在注册表里的名字。⚠ 声明成只读属性而不是可写字段：
        实现一律是冻结 dataclass，而冻结字段满足不了一个可写的协议成员。"""
        ...

    def narrow(self, context: TurnContext, allowed: Allowed) -> Allowed:
        """收窄一次。

        Args: context, allowed（上一道收窄之后剩下的）。
        """
        ...
