"""台账面那一跳跨进程依赖的假件。"""

from dataclasses import dataclass, field


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
