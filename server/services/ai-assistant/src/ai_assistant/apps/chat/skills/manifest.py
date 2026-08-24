"""一个技能的清单：它是什么、在哪些工作面上可用、带哪些工具。

⚠ 清单与指令正文分开：清单常驻提示词（几十个 token），正文只在这个技能被选中
之后才注入。铺满上下文的做法在技能变多之后会挤掉真正要紧的东西——工作面快照
与工具结果——而挤掉的是哪一段，从外面完全看不出来。
"""

from dataclasses import dataclass, field
from pathlib import Path

# 指令正文的文件名。与清单同处一个目录，改指令不用碰 Python
INSTRUCTIONS_FILE = "skill.md"


class SkillInstructionsMissing(RuntimeError):
    """技能目录里没有指令正文。装配期就该发现，不留到第一次对话。"""


@dataclass(frozen=True)
class SkillManifest:
    """一个技能。`name` 是它在全系统里的身份，落进步骤表也用它。"""

    name: str
    title: str
    # 一句话简介。**它就是模型选技能时看到的全部信息**，所以必须能与别的技能
    # 区分开：写成「帮你配大屏」这种，模型在四个技能之间只能瞎猜
    summary: str
    # 适用的工作面。⚠ 空元组表示「哪都不适用」，不是「哪都适用」——
    # 反过来解释的话，漏填的技能会在每个页面上都冒出来
    surface_kinds: tuple[str, ...]
    # 用它需要的权限码。助手不是绕过权限的通道：动作最终落到哪个端点，
    # 就按那个端点的码要求
    required_codes: tuple[str, ...] = ()
    # 本技能会用到的工具名。分两类是因为失败含义不同，见 enums.STEP_KINDS
    server_tools: tuple[str, ...] = ()
    client_tools: tuple[str, ...] = ()
    # 指令正文所在目录。默认取清单模块自己的目录
    directory: Path = field(default_factory=Path)

    def instructions(self) -> str:
        """读指令正文。

        ⚠ 读不到就抛而不是退回空串：空指令的技能仍会被模型选中，然后不带任何
        约束地乱做一气——那比「这个技能不存在」难查得多。
        """
        path = self.directory / INSTRUCTIONS_FILE
        if not path.is_file():
            raise SkillInstructionsMissing(f"{self.name} 缺少指令正文")
        return path.read_text(encoding="utf-8")
