"""服务端工具的执行面：按名字分派到实现。

⚠ 认不出的名字**抛**，不返回一个看起来正常的空结果。模型编出一个不存在的
工具名是常事；静默给它一个空结果，它会当成「查过了，没有」继续往下走，
最后给用户一个自信的错误答案。抛出去的话它拿到「没有这个工具」，
下一轮就会换一条路。

⚠ 每个实现都要能在**没有上游**时说清自己做不了什么。助手是纯消费方，
platform 不可达时该说的是「取不到点位」，不是把一条空清单当成「没有点位」。
"""

from dataclasses import dataclass
from typing import Any

from ai_assistant.apps.chat.skills import find_skill


class UnknownServerTool(RuntimeError):
    """叫了一个不存在的服务端工具。"""


@dataclass(frozen=True)
class ServerTools:
    """服务端工具的实现集合。"""

    async def __call__(self, name: str, arguments: dict[str, Any]) -> Any:
        """按名字跑一个工具。

        Args: name, arguments。
        """
        if name == "skills.load":
            return _load_skill(str(arguments.get("name") or ""))
        raise UnknownServerTool(f"没有这个工具：{name}")


def _load_skill(name: str) -> dict[str, Any]:
    """取一个技能的完整指令。

    ⚠ 技能不存在时回一句「没有这个技能」而不是抛：模型多半是把名字记岔了，
    告诉它有哪些比让这一步失败有用。

    Args: name。
    """
    skill = find_skill(name)
    if skill is None:
        return {"ok": False, "reason": f"没有名为 {name} 的技能"}
    return {
        "ok": True,
        "name": skill.name,
        "title": skill.title,
        "instructions": skill.instructions(),
    }
